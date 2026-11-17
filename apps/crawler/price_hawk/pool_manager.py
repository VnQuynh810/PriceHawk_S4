"""
pool_manager.py — Autonomous Self-Expanding Product Pool & Temperature-Tiered Lifecycle Manager.

Engines:
  1. `process_discovery_queue()`: Consumes seeds (`keyword` or `url`) injected by Admin,
     User Search misses, Chatbot misses, or Cross-Store Enrichment. Uses internal SearXNG
     + `UniversalExtractor` to discover & ingest product prices across multiple Vietnamese stores.
  2. `enrich_single_retailer_products()`: Automatically detects products in the pool with
     `retailer_count <= 1` and enqueues them for cross-store price discovery.
  3. `refresh_pool_by_temperature()`: Scales cleanly to 50k–200k+ products by refreshing URLs
     according to 4 temperature tiers:
       - HOT (Wishlist / Active Price Alert): every 15 mins
       - WARM (Viewed in 7d / Updated in 14d): every 3 hours
       - COLD (Older stable catalog): every 36 hours
       - DORMANT (fail_count >= 5 across all links): auto-paused (`is_active = 0`)
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import pymysql
import pymysql.cursors
import requests
from dotenv import load_dotenv

from .db_batch_processor import BatchDBProcessor
from .extractors import AISelectorHealer, UniversalExtractor
from .normalizer import canonicalize_url, to_ascii_lower
from .pipelines import NormalizePhonePipeline

load_dotenv()

DEFAULT_TRUSTED_DOMAINS = [
    "thegioididong.com",
    "dienmayxanh.com",
    "topzone.vn",
    "fptshop.com.vn",
    "hoanghamobile.com",
    "cellphones.com.vn",
    "didongviet.vn",
    "phongvu.vn",
    "gearvn.com",
    "clickbuy.com.vn",
    "hacom.vn",
    "anphatpc.com.vn",
    "mobilecity.vn",
]

NON_PRODUCT_URL_RE = re.compile(
    r"/(tin-tuc|blog|blogs|dchannel|cong-nghe|hoi-dap|dien-dan|tuyen-dung|lien-he|chinh-sach|tra-gop|gio-hang|cart|search|tim-kiem)(/|$|\?)",
    re.IGNORECASE,
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def infer_source_code_from_url(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower().replace("www.", "")
        if "thegioididong" in host or "topzone" in host or "dienmayxanh" in host:
            return "tgdd"
        if "fptshop" in host:
            return "fpt"
        if "hoanghamobile" in host:
            return "hoangha"
        if "cellphones" in host:
            return "cellphones"
        if "didongviet" in host:
            return "didongviet"
        if "phongvu" in host:
            return "phongvu"
        if "gearvn" in host:
            return "gearvn"
        if "clickbuy" in host:
            return "clickbuy"
        return host.split(".")[0] or "universal"
    except Exception:
        return "universal"


def keyword_matches_title(keyword: str, extracted_title: str) -> bool:
    """Ensures SearXNG discovery results actually correspond to the searched product."""
    kw_norm = to_ascii_lower(keyword)
    title_norm = to_ascii_lower(extracted_title)
    stopwords = {"dien", "thoai", "laptop", "tablet", "may", "tinh", "bang", "chinh", "hang", "gia", "re"}
    tokens = [t for t in re.findall(r"[a-z0-9]+", kw_norm) if len(t) >= 2 and t not in stopwords]
    if not tokens:
        return True
    matched = sum(1 for t in tokens if t in title_norm)
    # Require at least 60% of meaningful model/brand tokens to appear in the product title
    return (matched / len(tokens)) >= 0.6


class AutonomousPoolManager:
    def __init__(self, searxng_url: Optional[str] = None):
        self.searxng_url = (
            searxng_url or os.getenv("SEARXNG_URL") or "http://searxng:8080"
        ).rstrip("/")
        self.healer = AISelectorHealer()
        self.normalizer = NormalizePhonePipeline()

    def _get_conn(self):
        return pymysql.connect(
            host=os.getenv("DB_HOST") or os.getenv("MYSQL_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT") or os.getenv("MYSQL_PORT", "3306")),
            user=os.getenv("DB_USER") or os.getenv("MYSQL_USER", "root"),
            password=os.getenv("DB_PASSWORD") or os.getenv("MYSQL_PASSWORD", ""),
            database=os.getenv("DB_NAME") or os.getenv("MYSQL_DB", "pricecomparison"),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=8,
        )

    def _has_pool_schema(self, cur) -> bool:
        cur.execute("SHOW TABLES LIKE 'discovery_queue'")
        return cur.fetchone() is not None

    def get_trusted_domains(self) -> List[str]:
        domains = list(DEFAULT_TRUSTED_DOMAINS)
        try:
            conn = self._get_conn()
            with conn:
                with conn.cursor() as cur:
                    cur.execute("SHOW TABLES LIKE 'crawl_source'")
                    if cur.fetchone():
                        cur.execute("SELECT domain FROM crawl_source WHERE enabled = 1")
                        for r in cur.fetchall():
                            d = (r.get("domain") or "").strip().lower()
                            if d and d not in domains:
                                domains.append(d)
        except Exception:
            pass
        return domains

    def search_candidate_urls_via_searxng(
        self, keyword: str, trusted_domains: List[str], max_urls: int = 6
    ) -> List[str]:
        """Queries internal SearXNG for product pages across trusted retailers, preferring domain diversity."""
        top_sites = " OR ".join(f"site:{d}" for d in trusted_domains[:8])
        query = f"{keyword} giá ({top_sites})"

        try:
            resp = requests.get(
                f"{self.searxng_url}/search",
                params={"q": query, "format": "json"},
                timeout=8,
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except Exception as e:
            print(f"[PoolManager] SearXNG lookup warning for '{keyword}': {e}", flush=True)
            return []

        per_domain_picked: Dict[str, str] = {}
        overflow: List[str] = []

        for r in results:
            raw_url = r.get("url") or ""
            clean_url = canonicalize_url(raw_url)
            if not clean_url or NON_PRODUCT_URL_RE.search(clean_url):
                continue

            parsed = urlparse(clean_url)
            if not parsed.path or parsed.path == "/":
                continue
            host = (parsed.hostname or "").lower()
            matched_domain = next(
                (d for d in trusted_domains if host == d or host.endswith(f".{d}")),
                None,
            )
            if not matched_domain:
                continue

            if matched_domain not in per_domain_picked:
                per_domain_picked[matched_domain] = clean_url
            elif clean_url not in overflow and clean_url != per_domain_picked[matched_domain]:
                overflow.append(clean_url)

        ordered = list(per_domain_picked.values()) + overflow
        return ordered[:max_urls]

    def _fetch_and_extract_url(
        self, url: str, category_hint: Optional[str] = None, expected_keyword: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "vi-VN,vi;q=0.9"},
                timeout=10,
            )
            if resp.status_code >= 400:
                return None

            ext = UniversalExtractor.extract(resp.text, url=url)
            domain = (urlparse(url).hostname or "").lower().replace("www.", "")
            if not (ext.get("name") and ext.get("price")) and not ext.get("needs_js_render"):
                if domain and self.healer.can_attempt(domain):
                    healed = self.healer.discover_selectors(domain, resp.text, url=url)
                    if healed:
                        ext = UniversalExtractor.extract(resp.text, url=url, custom_selectors=healed)

            if not (ext.get("name") and ext.get("price")):
                return None

            if expected_keyword and not keyword_matches_title(expected_keyword, ext["name"]):
                return None

            clean_url = canonicalize_url(resp.url) or canonicalize_url(url) or url
            raw_item = {
                "source": infer_source_code_from_url(clean_url),
                "name": ext["name"],
                "brand": ext.get("brand"),
                "price": ext["price"],
                "in_stock": ext.get("in_stock", True),
                "product_url": clean_url,
                "image_url": ext.get("image_url"),
                "description": ext.get("description"),
                "category_path_raw": ext.get("category_hint") or category_hint,
            }
            return dict(self.normalizer.process_item(raw_item))
        except Exception:
            return None

    # ── Engine 1: Autonomous Discovery Queue Consumer ─────────────────────────

    def process_discovery_queue(self, batch_limit: int = 12) -> int:
        try:
            conn = self._get_conn()
            with conn:
                with conn.cursor() as cur:
                    if not self._has_pool_schema(cur):
                        return 0
                    cur.execute(
                        """
                        SELECT *
                        FROM discovery_queue
                        WHERE status = 'pending'
                        ORDER BY priority ASC, created_at ASC
                        LIMIT %s
                        """,
                        (batch_limit,),
                    )
                    seeds = list(cur.fetchall())
                    if not seeds:
                        return 0

                    ids = [s["id"] for s in seeds]
                    ph = ",".join(["%s"] * len(ids))
                    cur.execute(
                        f"UPDATE discovery_queue SET status = 'processing', attempts = attempts + 1 WHERE id IN ({ph})",
                        tuple(ids),
                    )
                conn.commit()
        except Exception as e:
            print(f"[PoolManager] Queue read error: {e}", flush=True)
            return 0

        trusted_domains = self.get_trusted_domains()
        db_writer = BatchDBProcessor(batch_size=100)
        total_ingested = 0

        for seed in seeds:
            seed_id = seed["id"]
            seed_type = seed["seed_type"]
            val = (seed["query_or_url"] or "").strip()
            cat_hint = seed.get("category_hint")
            ingested_for_seed = 0
            err_msg = None

            try:
                candidate_urls: List[Tuple[str, Optional[str]]] = []

                if seed_type == "url":
                    primary_item = self._fetch_and_extract_url(val, category_hint=cat_hint)
                    if primary_item:
                        db_writer.add_item(primary_item)
                        ingested_for_seed += 1
                        # Snowball effect: also discover rival retailers for this newly seeded URL!
                        extra_urls = self.search_candidate_urls_via_searxng(
                            primary_item["name"], trusted_domains, max_urls=5
                        )
                        for eu in extra_urls:
                            if eu != primary_item["product_url"]:
                                candidate_urls.append((eu, primary_item["name"]))
                else:
                    found_urls = self.search_candidate_urls_via_searxng(
                        val, trusted_domains, max_urls=6
                    )
                    candidate_urls = [(u, val) for u in found_urls]

                if candidate_urls:
                    with ThreadPoolExecutor(max_workers=4) as pool:
                        futs = [
                            pool.submit(self._fetch_and_extract_url, u, cat_hint, kw)
                            for u, kw in candidate_urls
                        ]
                        for f in as_completed(futs):
                            item = f.result()
                            if item:
                                db_writer.add_item(item)
                                ingested_for_seed += 1

                total_ingested += ingested_for_seed
            except Exception as e:
                err_msg = str(e)[:450]

            new_status = (
                "completed"
                if ingested_for_seed > 0
                else ("failed" if err_msg else "empty")
            )
            try:
                conn = self._get_conn()
                with conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE discovery_queue
                            SET status = %s,
                                matched_urls_count = %s,
                                last_error = %s,
                                processed_at = NOW()
                            WHERE id = %s
                            """,
                            (new_status, ingested_for_seed, err_msg, seed_id),
                        )
                    conn.commit()
            except Exception:
                pass

        db_writer.close()
        if total_ingested:
            print(f"[PoolManager] Expanded pool with {total_ingested} offer(s) from {len(seeds)} seed(s)!", flush=True)
        return total_ingested

    # ── Engine 2: Cross-Store Auto-Enrichment (retailer_count <= 1 -> Multi-Store) ─

    def enrich_single_retailer_products(self, limit: int = 8) -> int:
        try:
            conn = self._get_conn()
            with conn:
                with conn.cursor() as cur:
                    if not self._has_pool_schema(cur):
                        return 0
                    cur.execute("SHOW COLUMNS FROM `product` LIKE 'enriched_at'")
                    if not cur.fetchone():
                        return 0

                    cur.execute(
                        """
                        SELECT id, name, category
                        FROM product
                        WHERE is_active = 1
                          AND retailer_count <= 1
                          AND (enriched_at IS NULL OR enriched_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
                        ORDER BY id DESC
                        LIMIT %s
                        """,
                        (limit,),
                    )
                    lonely_products = list(cur.fetchall())
                    if not lonely_products:
                        return 0

                    for p in lonely_products:
                        cur.execute(
                            """
                            INSERT IGNORE INTO discovery_queue
                              (seed_type, query_or_url, category_hint, origin, priority, status)
                            VALUES ('keyword', %s, %s, 'cross_store_enrich', 4, 'pending')
                            """,
                            (p["name"][:500], p.get("category")),
                        )
                        cur.execute(
                            "UPDATE product SET enriched_at = NOW() WHERE id = %s",
                            (p["id"],),
                        )
                conn.commit()
                return len(lonely_products)
        except Exception as e:
            print(f"[PoolManager] Cross-store enrichment warning: {e}", flush=True)
            return 0

    # ── Engine 3: 4-Tier Temperature-Based Pool Refresh & Dormant Archiver ────

    def refresh_pool_by_temperature(self, budget_urls: int = 50) -> Dict[str, int]:
        stats = {"refreshed": 0, "failed": 0, "archived_dormant": 0}
        try:
            conn = self._get_conn()
            with conn:
                with conn.cursor() as cur:
                    cur.execute("SHOW COLUMNS FROM `product` LIKE 'is_active'")
                    if not cur.fetchone():
                        return stats

                    cur.execute(
                        """
                        SELECT
                          c.id AS comparison_id,
                          c.url,
                          c.name AS source_code,
                          p.id AS product_id,
                          p.name AS product_name,
                          p.brand,
                          p.category,
                          CASE
                            WHEN EXISTS (SELECT 1 FROM price_alert pa WHERE pa.product_id = p.id AND pa.status = 'active')
                              OR EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id = p.id)
                              THEN 1
                            WHEN (p.last_viewed_at IS NOT NULL AND p.last_viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
                              OR (p.updated_at IS NOT NULL AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY))
                              THEN 2
                            ELSE 3
                          END AS temp_tier
                        FROM comparison c
                        JOIN product p ON p.id = c.product_id
                        WHERE p.is_active = 1
                          AND c.fail_count < 5
                          AND (
                            (
                              (EXISTS (SELECT 1 FROM price_alert pa WHERE pa.product_id = p.id AND pa.status = 'active')
                               OR EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id = p.id))
                              AND (c.current_price_at IS NULL OR c.current_price_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
                            )
                            OR (
                              ((p.last_viewed_at IS NOT NULL AND p.last_viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
                               OR (p.updated_at IS NOT NULL AND p.updated_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)))
                              AND (c.current_price_at IS NULL OR c.current_price_at < DATE_SUB(NOW(), INTERVAL 3 HOUR))
                            )
                            OR (
                              c.current_price_at IS NULL OR c.current_price_at < DATE_SUB(NOW(), INTERVAL 36 HOUR)
                            )
                          )
                        ORDER BY temp_tier ASC, COALESCE(c.current_price_at, '1970-01-01') ASC
                        LIMIT %s
                        """,
                        (budget_urls,),
                    )
                    due_rows = list(cur.fetchall())
        except Exception as e:
            print(f"[PoolManager] Temperature refresh query warning: {e}", flush=True)
            return stats

        if not due_rows:
            return stats

        db_writer = BatchDBProcessor(batch_size=100)
        ok_comp_ids: List[Tuple[int, int]] = []
        failed_comp_ids: List[int] = []

        def _check_row(row: Dict[str, Any]):
            try:
                resp = requests.get(
                    row["url"],
                    headers={"User-Agent": USER_AGENT, "Accept-Language": "vi-VN,vi;q=0.9"},
                    timeout=9,
                )
                if resp.status_code in (404, 410) or resp.status_code >= 500:
                    return (row, None)
                ext = UniversalExtractor.extract(resp.text, url=row["url"])
                if not ext.get("price"):
                    return (row, None)
                return (row, ext)
            except Exception:
                return (row, None)

        with ThreadPoolExecutor(max_workers=4) as pool:
            for row, ext in pool.map(_check_row, due_rows):
                if ext and ext.get("price"):
                    raw_item = {
                        "source": row["source_code"],
                        "name": ext.get("name") or row["product_name"],
                        "brand": ext.get("brand") or row["brand"],
                        "price": ext["price"],
                        "in_stock": ext.get("in_stock", True),
                        "product_url": row["url"],
                        "image_url": ext.get("image_url"),
                        "description": ext.get("description"),
                        "category_path_raw": ext.get("category") or ext.get("category_hint"),
                    }
                    db_writer.add_item(dict(self.normalizer.process_item(raw_item)))
                    ok_comp_ids.append((1 if ext.get("in_stock", True) else 0, int(row["comparison_id"])))
                    stats["refreshed"] += 1
                else:
                    failed_comp_ids.append(int(row["comparison_id"]))
                    stats["failed"] += 1

        db_writer.close()

        # Update link health & archive completely dead products into DORMANT tier
        try:
            conn = self._get_conn()
            with conn:
                with conn.cursor() as cur:
                    if ok_comp_ids:
                        cur.executemany(
                            "UPDATE comparison SET fail_count = 0, in_stock = %s WHERE id = %s",
                            ok_comp_ids,
                        )
                    if failed_comp_ids:
                        f_ph = ",".join(["%s"] * len(failed_comp_ids))
                        cur.execute(
                            f"""
                            UPDATE comparison
                            SET fail_count = LEAST(250, fail_count + 1),
                                current_price_at = NOW()
                            WHERE id IN ({f_ph})
                            """,
                            tuple(failed_comp_ids),
                        )
                        # Transition products where ALL comparison links failed >= 5 times to DORMANT
                        cur.execute(
                            """
                            UPDATE product p
                            SET p.is_active = 0
                            WHERE p.is_active = 1
                              AND EXISTS (SELECT 1 FROM comparison c WHERE c.product_id = p.id)
                              AND NOT EXISTS (
                                SELECT 1 FROM comparison c
                                WHERE c.product_id = p.id AND c.fail_count < 5
                              )
                            """
                        )
                        stats["archived_dormant"] = cur.rowcount
                conn.commit()
        except Exception:
            pass

        return stats

    def run_maintenance_cycle(self):
        self.enrich_single_retailer_products(limit=8)
        self.process_discovery_queue(batch_limit=12)
        self.refresh_pool_by_temperature(budget_urls=50)
