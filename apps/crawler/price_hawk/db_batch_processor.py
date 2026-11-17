import os
from typing import Dict, List, Optional, Set
import pymysql
from dotenv import load_dotenv
from .normalizer import canonicalize_url
from .product_matcher import ProductMatcher

load_dotenv()


class BatchDBProcessor:
    """
    High-efficiency bulk MySQL writer for PriceHawk spiders:
      1. Supports unified DB_* env vars (with fallback to legacy MYSQL_* vars).
      2. Pre-fetches existing products & URLs in bulk to avoid burning millions of
         AUTO_INCREMENT IDs via unnecessary ON DUPLICATE KEY UPDATE calls.
      3. Computes accurate cross-retailer MIN(price) & retailer_count in SQL so a
         slower/more expensive shop never overwrites a cheaper shop's current_price.
      4. Evaluates active price_alert triggers in a single batch query on close().
    """

    def __init__(self, batch_size: int = 200, auto_commit: bool = True):
        self.batch_size = batch_size
        self.auto_commit = auto_commit
        self.buffer: List[Dict] = []
        self.conn: Optional[pymysql.Connection] = None
        self.cursor: Optional[pymysql.cursors.Cursor] = None
        self.matcher = ProductMatcher(fuzzy_threshold=95)
        self._has_extended_columns: Optional[bool] = None
        self._init_connection()

    def _init_connection(self):
        host = os.getenv("DB_HOST") or os.getenv("MYSQL_HOST", "127.0.0.1")
        port = int(os.getenv("DB_PORT") or os.getenv("MYSQL_PORT", "3306"))
        user = os.getenv("DB_USER") or os.getenv("MYSQL_USER", "root")
        password = os.getenv("DB_PASSWORD") or os.getenv("MYSQL_PASSWORD", "")
        database = os.getenv("DB_NAME") or os.getenv("MYSQL_DB", "pricecomparison")

        self.conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset="utf8mb4",
            connect_timeout=10,
            read_timeout=30,
            write_timeout=30,
        )
        self.cursor = self.conn.cursor()

    def _ensure_connection(self):
        if self.conn is None:
            self._init_connection()
            return
        try:
            self.conn.ping(reconnect=True)
            self.cursor = self.conn.cursor()
        except Exception:
            self._init_connection()

    def _check_extended_schema(self) -> bool:
        if self._has_extended_columns is not None:
            return self._has_extended_columns
        try:
            self.cursor.execute("SHOW COLUMNS FROM `product` LIKE 'retailer_count'")
            self._has_extended_columns = self.cursor.fetchone() is not None
        except Exception:
            self._has_extended_columns = False
        return self._has_extended_columns

    def add_item(self, item: Dict) -> bool:
        self.buffer.append(item)
        if len(self.buffer) >= self.batch_size:
            return self.flush()
        return True

    def flush(self) -> bool:
        if not self.buffer:
            return True

        self._ensure_connection()
        has_ext = self._check_extended_schema()

        try:
            groups = self.matcher.group_products(self.buffer)

            # 1. Prepare canonical product groups keyed by identity_key
            prepared_groups: Dict[str, List[Dict]] = {}
            for group in groups:
                if not group:
                    continue
                rep = group[0]
                brand = (rep.get("brand_norm") or "").lower().replace(" ", "_")
                model = (rep.get("model_key") or "").lower().replace(" ", "_")
                variant = (rep.get("variant_key") or "").lower().replace(" ", "_")
                if not (brand and model and variant):
                    continue
                identity_key = f"{brand}_{model}_{variant}"
                prepared_groups.setdefault(identity_key, []).extend(group)

            if not prepared_groups:
                self.buffer = []
                return True

            identity_keys = list(prepared_groups.keys())

            # 2. Pre-fetch existing product IDs in ONE query (prevents AUTO_INCREMENT burn)
            placeholders = ",".join(["%s"] * len(identity_keys))
            self.cursor.execute(
                f"SELECT identity_key, id FROM product WHERE identity_key IN ({placeholders})",
                tuple(identity_keys),
            )
            product_id_map: Dict[str, int] = {
                row[0]: int(row[1]) for row in self.cursor.fetchall()
            }

            # 3. Insert ONLY brand-new products; update metadata on existing ones
            new_products = []
            existing_updates = []
            for ikey, items in prepared_groups.items():
                rep = items[0]
                prices = [int(p["price"]) for p in items if p.get("price") is not None]
                batch_min_price = min(prices) if prices else None
                name = rep.get("name") or ikey
                desc = rep.get("description")
                img = rep.get("image_url")
                brand = (rep.get("brand_norm") or "").lower().replace(" ", "_")
                cat = rep.get("category") or rep.get("category_path_raw")

                if ikey not in product_id_map:
                    if has_ext:
                        new_products.append((ikey, name[:500], desc, img, brand, cat, batch_min_price))
                    else:
                        new_products.append((ikey, name[:500], desc, img, brand, batch_min_price))
                else:
                    existing_updates.append((img, desc, product_id_map[ikey]))

            if new_products:
                if has_ext:
                    self.cursor.executemany(
                        """
                        INSERT IGNORE INTO product
                          (identity_key, name, description, image_url, brand, category, current_price, source)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, 'crawler')
                        """,
                        new_products,
                    )
                else:
                    self.cursor.executemany(
                        """
                        INSERT IGNORE INTO product
                          (identity_key, name, description, image_url, brand, current_price)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        new_products,
                    )
                # Re-fetch IDs for newly inserted keys
                missing_keys = [k for k in identity_keys if k not in product_id_map]
                if missing_keys:
                    m_ph = ",".join(["%s"] * len(missing_keys))
                    self.cursor.execute(
                        f"SELECT identity_key, id FROM product WHERE identity_key IN ({m_ph})",
                        tuple(missing_keys),
                    )
                    for row in self.cursor.fetchall():
                        product_id_map[row[0]] = int(row[1])

            if existing_updates:
                self.cursor.executemany(
                    """
                    UPDATE product
                    SET image_url = COALESCE(%s, image_url),
                        description = COALESCE(%s, description)
                    WHERE id = %s
                    """,
                    existing_updates,
                )

            # 4. Deduplicate comparison items by canonical URL within batch
            url_items: Dict[str, tuple] = {}
            for ikey, items in prepared_groups.items():
                pid = product_id_map.get(ikey)
                if not pid:
                    continue
                for item in items:
                    price = item.get("price")
                    url = canonicalize_url(item.get("product_url"))
                    source = item.get("source") or "unknown"
                    if price is not None and url:
                        url_items[url] = (pid, int(price), url, source)

            touched_pids: Set[int] = set()

            if url_items:
                urls = list(url_items.keys())
                u_ph = ",".join(["%s"] * len(urls))
                self.cursor.execute(
                    f"SELECT url, id, price FROM comparison WHERE url IN ({u_ph})",
                    tuple(urls),
                )
                existing_comp_map = {
                    row[0]: (int(row[1]), int(round(row[2])) if row[2] is not None else None)
                    for row in self.cursor.fetchall()
                }

                comp_updates = []
                comp_inserts = []
                history_inserts = []

                for url, (pid, price, clean_url, source) in url_items.items():
                    touched_pids.add(pid)
                    if url in existing_comp_map:
                        comp_id, old_price = existing_comp_map[url]
                        comp_updates.append((pid, price, source, price, price, price, comp_id))
                        if old_price is None or old_price != price:
                            history_inserts.append((pid, comp_id, price, source))
                    else:
                        comp_inserts.append((pid, price, clean_url, source, price))

                if comp_updates:
                    self.cursor.executemany(
                        """
                        UPDATE comparison
                        SET product_id = %s,
                            price = %s,
                            name = %s,
                            current_price_at = NOW(),
                            min_price = CASE
                                WHEN min_price IS NULL OR %s < min_price THEN %s
                                ELSE min_price
                            END,
                            min_price_at = CASE
                                WHEN min_price IS NULL OR %s < min_price THEN NOW()
                                ELSE min_price_at
                            END
                        WHERE id = %s
                        """,
                        comp_updates,
                    )

                if comp_inserts:
                    self.cursor.executemany(
                        """
                        INSERT IGNORE INTO comparison
                          (product_id, price, url, name, current_price_at, min_price, min_price_at)
                        VALUES (%s, %s, %s, %s, NOW(), %s, NOW())
                        """,
                        comp_inserts,
                    )
                    ins_urls = [c[2] for c in comp_inserts]
                    iu_ph = ",".join(["%s"] * len(ins_urls))
                    self.cursor.execute(
                        f"SELECT url, id FROM comparison WHERE url IN ({iu_ph})",
                        tuple(ins_urls),
                    )
                    inserted_ids = {row[0]: int(row[1]) for row in self.cursor.fetchall()}
                    for pid, price, clean_url, source, _ in comp_inserts:
                        cid = inserted_ids.get(clean_url)
                        if cid:
                            history_inserts.append((pid, cid, price, source))

                if history_inserts:
                    self.cursor.executemany(
                        """
                        INSERT INTO price_history (product_id, comparison_id, price, retailer, recorded_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        """,
                        history_inserts,
                    )

            # 5. Recompute true cross-shop MIN(price) & retailer_count for touched products
            if touched_pids:
                p_ph = ",".join(["%s"] * len(touched_pids))
                pid_tuple = tuple(touched_pids)
                if has_ext:
                    self.cursor.execute(
                        f"""
                        UPDATE product p
                        JOIN (
                            SELECT product_id, MIN(price) AS min_p, COUNT(*) AS cnt
                            FROM comparison
                            WHERE product_id IN ({p_ph})
                            GROUP BY product_id
                        ) agg ON agg.product_id = p.id
                        SET p.current_price = agg.min_p,
                            p.retailer_count = agg.cnt
                        """,
                        pid_tuple,
                    )
                else:
                    self.cursor.execute(
                        f"""
                        UPDATE product p
                        JOIN (
                            SELECT product_id, MIN(price) AS min_p
                            FROM comparison
                            WHERE product_id IN ({p_ph})
                            GROUP BY product_id
                        ) agg ON agg.product_id = p.id
                        SET p.current_price = agg.min_p
                        """,
                        pid_tuple,
                    )

            if self.auto_commit:
                self.conn.commit()

            flushed_count = len(self.buffer)
            self.buffer = []
            print(f"[BatchDBProcessor] Flushed {flushed_count} items ({len(prepared_groups)} products).")
            return True

        except Exception as e:
            print(f"[BatchDBProcessor] Flush error: {e}")
            if self.conn:
                self.conn.rollback()
            return False

    def evaluate_price_alerts(self):
        """Event-driven trigger: marks active alerts as 'triggered' immediately after crawl."""
        try:
            self._ensure_connection()
            self.cursor.execute(
                """
                UPDATE price_alert pa
                JOIN product p ON p.id = pa.product_id
                SET pa.status = 'triggered',
                    pa.triggered_at = NOW()
                WHERE pa.status = 'active'
                  AND p.current_price IS NOT NULL
                  AND p.current_price <= pa.target_price
                """
            )
            triggered = self.cursor.rowcount
            if self.auto_commit:
                self.conn.commit()
            if triggered:
                print(f"[BatchDBProcessor] Triggered {triggered} price alert(s)!")
        except Exception as e:
            print(f"[BatchDBProcessor] Alert trigger evaluation skipped/failed: {e}")

    def save_healed_selectors(self, source_code: str, selectors: Dict):
        """Persists AI-discovered CSS selectors back to crawl_source for zero-cost future runs."""
        import json
        try:
            self._ensure_connection()
            self.cursor.execute(
                "UPDATE crawl_source SET selectors_json = %s WHERE code = %s",
                (json.dumps(selectors, ensure_ascii=False), source_code),
            )
            if self.auto_commit:
                self.conn.commit()
            print(f"[BatchDBProcessor] Saved AI-healed selectors for '{source_code}'")
        except Exception as e:
            print(f"[BatchDBProcessor] Could not save healed selectors: {e}")

    def save_url_states(self, url_states: List[tuple]):
        """Persists sitemap <lastmod> hashes for incremental crawling."""
        if not url_states:
            return
        try:
            self._ensure_connection()
            self.cursor.executemany(
                """
                INSERT INTO crawl_url_state (url_hash, source_code, url, sitemap_lastmod, last_fetched_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                  sitemap_lastmod = VALUES(sitemap_lastmod),
                  last_fetched_at = NOW()
                """,
                url_states,
            )
            if self.auto_commit:
                self.conn.commit()
        except Exception:
            pass

    def close(self):
        self.flush()
        self.evaluate_price_alerts()
        if self.cursor:
            self.cursor.close()
        if self.conn:
            self.conn.close()
            self.conn = None
