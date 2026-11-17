"""
db.py — Async-safe MySQL Connection Pool & Fulltext Product Search for Chatbot.
Respects global MySQL connection budget (maxconnections=5).
"""

import asyncio
import difflib
import os
import re
import unicodedata
import pymysql
import pymysql.cursors
from dotenv import load_dotenv
from dbutils.pooled_db import PooledDB

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", "3307")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", "rootpassword"),
    "db": os.getenv("DB_NAME", "pricecomparison"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "connect_timeout": 5,
    "read_timeout": 10,
}

_pool: PooledDB | None = None


def get_pool() -> PooledDB:
    global _pool
    if _pool is None:
        _pool = PooledDB(
            creator=pymysql,
            maxconnections=int(os.getenv("CHATBOT_DB_POOL_LIMIT", "5")),
            mincached=1,
            maxcached=3,
            blocking=True,
            **DB_CONFIG,
        )
    return _pool


def get_connection():
    return get_pool().connection()


def _remove_diacritics(text: str) -> str:
    text = text.replace("Đ", "D").replace("đ", "d")
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def check_similarity(query: str, target: str) -> float:
    q_norm = _remove_diacritics(query.lower())
    t_norm = _remove_diacritics(target.lower())

    noise = [
        "gia bao nhieu", "bao nhieu tien", "gia", "mua", "o dau",
        "tot khong", "review", "danh gia", "co tot khong", "nen mua",
    ]
    for n in noise:
        q_norm = q_norm.replace(n, "")
        t_norm = t_norm.replace(n, "")

    q_norm = re.sub(r"[^\w\s]", " ", q_norm).strip()
    t_norm = re.sub(r"[^\w\s]", " ", t_norm).strip()

    q_words = set(q_norm.split())
    t_words = set(t_norm.split())

    if not q_words:
        return 0.0

    sim = difflib.SequenceMatcher(None, q_norm, t_norm).ratio()
    overlap = len(q_words.intersection(t_words)) / len(q_words)
    return (sim * 0.4) + (overlap * 0.6)


def _build_boolean_ft_query(keyword: str) -> str | None:
    tokens = [
        t for t in re.sub(r"[+\-><()~*\"@]+", " ", keyword).split() if len(t) >= 2
    ][:8]
    if not tokens:
        return None
    return " ".join(f"+{t}*" for t in tokens)


def _do_db_search(keyword: str, limit: int = 50) -> list[dict]:
    """Tries MySQL FULLTEXT ngram search first, falling back to parameterized LIKE."""
    ft_query = _build_boolean_ft_query(keyword)
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cursor:
                if ft_query:
                    try:
                        cursor.execute(
                            """
                            SELECT
                                p.id, p.name, p.image_url, p.brand,
                                c.name AS retailer, c.price, c.url AS retailer_url
                            FROM product p
                            JOIN comparison c ON p.id = c.product_id
                            WHERE MATCH(p.name, p.brand) AGAINST (%s IN BOOLEAN MODE)
                            ORDER BY c.price ASC
                            LIMIT %s
                            """,
                            [ft_query, limit],
                        )
                        rows = cursor.fetchall()
                        if rows:
                            return list(rows)
                    except Exception:
                        pass

                cursor.execute(
                    """
                    SELECT
                        p.id, p.name, p.image_url, p.brand,
                        c.name AS retailer, c.price, c.url AS retailer_url
                    FROM product p
                    JOIN comparison c ON p.id = c.product_id
                    WHERE p.name LIKE %s
                    ORDER BY c.price ASC
                    LIMIT %s
                    """,
                    [f"%{keyword}%", limit],
                )
                rows = cursor.fetchall()
                return list(rows) if rows else []
    except Exception as e:
        print(f"[DB] Search error for '{keyword}': {e}")
        return []


def search_products(keyword: str, category: str | None = None, limit: int = 8) -> tuple[list[dict], str]:
    if not keyword or not keyword.strip():
        return [], "none"

    keyword_clean = keyword.strip()
    candidates = _do_db_search(keyword_clean, limit=50)

    if not candidates:
        stopwords = {
            "gia", "bao", "nhieu", "tien", "nao", "mua", "ban", "co", "tot",
            "review", "danh", "the", "nen", "nhat", "re", "dau", "loai", "loại",
            "giá", "nên", "tốt", "rẻ", "nhất", "đâu",
        }
        meaningful = [
            w for w in keyword_clean.split() if len(w) > 2 and w.lower() not in stopwords
        ]
        meaningful.sort(
            key=lambda w: (
                not any(c.isdigit() for c in w),
                not any(c.isupper() for c in w),
            )
        )
        for word in meaningful[:3]:
            candidates.extend(_do_db_search(word, limit=40))

    if not candidates:
        return [], "none"

    unique_cands = {}
    for c in candidates:
        key = f"{c['id']}_{c['retailer']}"
        if key not in unique_cands:
            unique_cands[key] = c

    scored_products = {}
    for c in unique_cands.values():
        pid = c["id"]
        if pid not in scored_products:
            scored_products[pid] = check_similarity(keyword_clean, c["name"])

    exact_pids = {pid: s for pid, s in scored_products.items() if s >= 0.85}
    partial_pids = {pid: s for pid, s in scored_products.items() if s >= 0.60}

    passed_pids = exact_pids if exact_pids else partial_pids
    match_type = "exact" if exact_pids else ("partial" if partial_pids else "none")
    if not passed_pids:
        return [], "none"

    sorted_pids = sorted(passed_pids.keys(), key=lambda pid: passed_pids[pid], reverse=True)
    top_pids = set(sorted_pids[:limit])
    final_rows = [c for c in unique_cands.values() if c["id"] in top_pids]
    return final_rows, match_type


async def search_products_async(keyword: str, category: str | None = None, limit: int = 8) -> tuple[list[dict], str]:
    """Runs synchronous PyMySQL pooled search off the main Uvicorn event loop."""
    return await asyncio.to_thread(search_products, keyword, category, limit)


def group_by_product(rows: list[dict]) -> list[dict]:
    grouped: dict[int, dict] = {}
    for row in rows:
        pid = row["id"]
        if pid not in grouped:
            grouped[pid] = {
                "id": pid,
                "name": row["name"],
                "image_url": row.get("image_url"),
                "brand": row.get("brand"),
                "prices": [],
            }
        grouped[pid]["prices"].append(
            {
                "retailer": row["retailer"],
                "price": row["price"],
                "url": row["retailer_url"],
            }
        )

    for p in grouped.values():
        p["prices"].sort(key=lambda x: x["price"] or float("inf"))

    return list(grouped.values())


def is_db_available() -> bool:
    try:
        conn = get_connection()
        with conn:
            return True
    except Exception:
        return False


async def is_db_available_async() -> bool:
    return await asyncio.to_thread(is_db_available)


def enqueue_discovery_keyword(keyword: str, category: str | None = None) -> None:
    """Enqueues a missing/partial chatbot product query into `discovery_queue` for pool auto-expansion."""
    cleaned = (keyword or "").strip()
    if len(cleaned) < 3 or len(cleaned) > 200:
        return
    try:
        conn = get_connection()
        with conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT IGNORE INTO discovery_queue
                      (seed_type, query_or_url, category_hint, origin, priority, status)
                    VALUES ('keyword', %s, %s, 'chatbot_miss', 2, 'pending')
                    """,
                    [cleaned, category],
                )
            conn.commit()
    except Exception:
        pass


async def enqueue_discovery_keyword_async(keyword: str, category: str | None = None) -> None:
    await asyncio.to_thread(enqueue_discovery_keyword, keyword, category)
