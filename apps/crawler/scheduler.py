#!/usr/bin/env python3
"""
scheduler.py — Dynamic Multi-Website Crawler Orchestrator & Distributed Queue Dispatcher.

Capabilities:
  1. Reads enabled crawl sources dynamically from MySQL `crawl_source` (zero code deploy to add new sites!).
  2. Staggered Priority Scheduling: only crawls sources whose `next_run_at <= NOW()`, preventing
     50+ websites from stampeding CPU/RAM simultaneously.
  3. Hot-Product Fast-Track: refreshes watched URLs (in `wishlist` or active `price_alert`)
     older than 15 minutes via lightweight HTTP + UniversalExtractor.
  4. Dual Execution Engine:
     - Local ThreadPool (default on single 1-2GB VPS).
     - Distributed Redis Job Queue (`CRAWLER_QUEUE_MODE=redis`) for horizontal multi-worker scaling.
  5. Graceful Fallback: if `crawl_source` table is absent, falls back to built-in spiders.
"""

import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

import pymysql
import pymysql.cursors
import requests
from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))

from price_hawk.db_batch_processor import BatchDBProcessor
from price_hawk.extractors import UniversalExtractor
from price_hawk.pipelines import NormalizePhonePipeline
from price_hawk.pool_manager import AutonomousPoolManager

MAX_WORKERS = max(1, min(6, int(os.getenv("CRAWLER_MAX_WORKERS", "2"))))
MAX_SOURCES_PER_TICK = max(1, int(os.getenv("CRAWLER_MAX_SOURCES_PER_TICK", "8")))
BUILTIN_CATEGORIES = ["dien-thoai", "laptop", "tablet"]


def get_db_connection():
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


def fetch_due_sources() -> Optional[List[Dict[str, Any]]]:
    """Returns due crawl_source rows, or None if table doesn't exist yet."""
    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SHOW TABLES LIKE 'crawl_source'")
                if not cur.fetchone():
                    return None
                cur.execute(
                    """
                    SELECT *
                    FROM crawl_source
                    WHERE enabled = 1
                      AND (next_run_at IS NULL OR next_run_at <= NOW())
                    ORDER BY priority ASC, COALESCE(next_run_at, '1970-01-01') ASC
                    LIMIT %s
                    """,
                    (MAX_SOURCES_PER_TICK,),
                )
                sources = list(cur.fetchall())

                # Attach known <lastmod> map per universal source (up to 5000 recent URLs)
                for src in sources:
                    if src.get("discovery_mode") == "sitemap":
                        cur.execute(
                            """
                            SELECT url_hash, sitemap_lastmod
                            FROM crawl_url_state
                            WHERE source_code = %s AND sitemap_lastmod IS NOT NULL
                            ORDER BY last_fetched_at DESC
                            LIMIT 5000
                            """,
                            (src["code"],),
                        )
                        src["known_lastmod"] = {
                            r["url_hash"]: r["sitemap_lastmod"] for r in cur.fetchall()
                        }
                return sources
    except Exception as e:
        print(f"[Scheduler] Warning reading crawl_source: {e}", flush=True)
        return None


def mark_source_running(source_id: int):
    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE crawl_source SET last_status = 'running' WHERE id = %s",
                    (source_id,),
                )
            conn.commit()
    except Exception:
        pass


def mark_source_finished(source: Dict[str, Any], success: bool, error_msg: Optional[str] = None):
    source_id = source.get("id")
    if not source_id:
        return
    interval = max(5, int(source.get("crawl_interval_minutes") or 30))
    failures = 0 if success else min(10, int(source.get("consecutive_failures") or 0) + 1)
    # Exponential backoff for repeatedly failing sites (caps at 6 hours)
    next_minutes = interval if success else min(360, interval * (2 ** min(failures, 3)))
    status = "success" if success else "failed"

    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS cnt FROM comparison WHERE name = %s", (source["code"],))
                item_cnt = int((cur.fetchone() or {}).get("cnt") or 0)
                cur.execute(
                    """
                    UPDATE crawl_source
                    SET last_status = %s,
                        last_item_count = %s,
                        last_error = %s,
                        consecutive_failures = %s,
                        last_crawled_at = NOW(),
                        next_run_at = DATE_ADD(NOW(), INTERVAL %s MINUTE)
                    WHERE id = %s
                    """,
                    (status, item_cnt, error_msg, failures, next_minutes, source_id),
                )
            conn.commit()
    except Exception as e:
        print(f"[Scheduler] Telemetry update warning: {e}", flush=True)


def refresh_hot_watched_products(max_urls: int = 30):
    """
    Fast-track incremental refresh for products actively watched in `price_alert` or `wishlist`
    whose comparison URLs haven't been checked in the last 15 minutes.
    """
    try:
        conn = get_db_connection()
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT c.url, c.name AS source_code, p.brand, p.name AS product_name
                    FROM comparison c
                    JOIN product p ON p.id = c.product_id
                    WHERE (
                        EXISTS (SELECT 1 FROM price_alert pa WHERE pa.product_id = p.id AND pa.status = 'active')
                        OR EXISTS (SELECT 1 FROM wishlist w WHERE w.product_id = p.id)
                    )
                    AND (c.current_price_at IS NULL OR c.current_price_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
                    LIMIT %s
                    """,
                    (max_urls,),
                )
                hot_rows = list(cur.fetchall())
    except Exception:
        return

    if not hot_rows:
        return

    print(f"[Scheduler] Fast-tracking {len(hot_rows)} hot watched product URL(s)...", flush=True)
    normalizer_pipe = NormalizePhonePipeline()
    db_writer = BatchDBProcessor(batch_size=50)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "vi-VN,vi;q=0.9",
    }

    refreshed = 0
    for row in hot_rows:
        try:
            resp = requests.get(row["url"], headers=headers, timeout=8)
            if resp.status_code >= 400:
                continue
            ext = UniversalExtractor.extract(resp.text, url=row["url"])
            if ext.get("price"):
                raw_item = {
                    "source": row["source_code"],
                    "name": ext.get("name") or row["product_name"],
                    "brand": ext.get("brand") or row["brand"],
                    "price": ext["price"],
                    "in_stock": ext.get("in_stock", True),
                    "product_url": row["url"],
                    "image_url": ext.get("image_url"),
                    "description": ext.get("description"),
                    "category_path_raw": ext.get("category_hint"),
                }
                clean_item = normalizer_pipe.process_item(raw_item)
                db_writer.add_item(dict(clean_item))
                refreshed += 1
        except Exception:
            continue

    db_writer.close()
    if refreshed:
        print(f"[Scheduler] Refreshed {refreshed}/{len(hot_rows)} hot watched URLs.", flush=True)


def execute_source_job(source: Dict[str, Any]) -> tuple[str, bool, Optional[str]]:
    code = source["code"]
    mode = source.get("discovery_mode") or "sitemap"
    delay_sec = round(max(100, int(source.get("request_delay_ms") or 300)) / 1000.0, 2)

    if source.get("id"):
        mark_source_running(int(source["id"]))

    start = time.time()

    try:
        if mode == "builtin_spider":
            spider_name = source.get("spider_name") or f"{code}_catalog"
            raw_cats = source.get("start_urls") or BUILTIN_CATEGORIES
            if isinstance(raw_cats, str):
                raw_cats = json.loads(raw_cats)
            categories = [c for c in raw_cats if isinstance(c, str)] or BUILTIN_CATEGORIES

            all_ok = True
            last_err = None
            for cat in categories:
                cmd = [
                    sys.executable, "-m", "scrapy", "crawl", spider_name,
                    "-a", f"category={cat}",
                    "-s", f"DOWNLOAD_DELAY={delay_sec}",
                    "-s", "LOG_LEVEL=WARNING",
                ]
                res = subprocess.run(cmd, cwd=ROOT_DIR, capture_output=True, text=True, timeout=300)
                if res.returncode != 0:
                    all_ok = False
                    last_err = (res.stderr or res.stdout or "")[-400:]
            mark_source_finished(source, all_ok, last_err)
            print(f"[Scheduler] {'OK' if all_ok else 'PARTIAL/FAIL'} builtin:{code} ({time.time() - start:.1f}s)", flush=True)
            return (code, all_ok, last_err)

        # Universal dynamic spider execution
        serializable_cfg = {
            "code": code,
            "domain": source.get("domain"),
            "discovery_mode": mode,
            "start_urls": (
                json.loads(source["start_urls"])
                if isinstance(source.get("start_urls"), str)
                else source.get("start_urls")
            ),
            "url_include_pattern": source.get("url_include_pattern"),
            "url_exclude_pattern": source.get("url_exclude_pattern"),
            "selectors_json": (
                json.loads(source["selectors_json"])
                if isinstance(source.get("selectors_json"), str)
                else source.get("selectors_json")
            ),
            "render_mode": source.get("render_mode") or "auto_escalate",
            "default_category": source.get("default_category"),
            "max_items_per_run": int(source.get("max_items_per_run") or 1500),
            "proxy_url": source.get("proxy_url"),
            "known_lastmod": source.get("known_lastmod") or {},
        }

        cmd = [
            sys.executable, "-m", "scrapy", "crawl", "universal_catalog",
            "-a", f"config_json={json.dumps(serializable_cfg, ensure_ascii=False)}",
            "-s", f"DOWNLOAD_DELAY={delay_sec}",
            "-s", "LOG_LEVEL=WARNING",
        ]
        res = subprocess.run(cmd, cwd=ROOT_DIR, capture_output=True, text=True, timeout=420)
        ok = res.returncode == 0
        err = None if ok else (res.stderr or res.stdout or "")[-400:]
        mark_source_finished(source, ok, err)
        print(f"[Scheduler] {'OK' if ok else 'FAIL'} universal:{code} ({time.time() - start:.1f}s)", flush=True)
        return (code, ok, err)

    except subprocess.TimeoutExpired:
        err = f"Timeout after {time.time() - start:.0f}s"
        mark_source_finished(source, False, err)
        print(f"[Scheduler] TIMEOUT {code}", flush=True)
        return (code, False, err)
    except Exception as e:
        mark_source_finished(source, False, str(e))
        print(f"[Scheduler] ERROR {code}: {e}", flush=True)
        return (code, False, str(e))


def enqueue_sources_to_redis(sources: List[Dict[str, Any]]) -> bool:
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return False
    try:
        import redis
        r = redis.from_url(redis_url, socket_connect_timeout=2)
        for src in sources:
            if src.get("id"):
                mark_source_running(int(src["id"]))
            # Convert datetime objects before JSON serialization
            clean_src = {
                k: (str(v) if hasattr(v, "isoformat") else v)
                for k, v in src.items()
            }
            r.rpush("pricehawk:queue:crawl_jobs", json.dumps(clean_src, ensure_ascii=False))
        print(f"[Scheduler] Dispatched {len(sources)} source job(s) to Redis queue.", flush=True)
        return True
    except Exception as e:
        print(f"[Scheduler] Redis dispatch failed, falling back to local ThreadPool: {e}", flush=True)
        return False


def run_scheduler_cycle() -> int:
    # Step 1: Run Autonomous Self-Expanding Product Pool & 4-Tier Temperature Refresh
    try:
        AutonomousPoolManager().run_maintenance_cycle()
    except Exception as e:
        print(f"[Scheduler] Pool maintenance warning: {e}", flush=True)
        refresh_hot_watched_products()

    # Step 2: Fetch due dynamic & built-in sources from DB
    due_sources = fetch_due_sources()

    if due_sources is None:
        # Legacy DB fallback if Migration 004 hasn't run yet
        print("[Scheduler] `crawl_source` table not found — falling back to built-in spiders.", flush=True)
        due_sources = [
            {"code": "tgdd", "discovery_mode": "builtin_spider", "spider_name": "tgdd_catalog", "start_urls": BUILTIN_CATEGORIES},
            {"code": "fpt", "discovery_mode": "builtin_spider", "spider_name": "fpt_catalog", "start_urls": BUILTIN_CATEGORIES},
            {"code": "hoangha", "discovery_mode": "builtin_spider", "spider_name": "hoangha_catalog", "start_urls": BUILTIN_CATEGORIES},
        ]

    if not due_sources:
        print("[Scheduler] All enabled sources are up-to-date (none due right now).", flush=True)
        return 0

    if os.getenv("CRAWLER_QUEUE_MODE") == "redis" and enqueue_sources_to_redis(due_sources):
        return 0

    print(f"[Scheduler] Executing {len(due_sources)} due source(s) with {MAX_WORKERS} worker(s)...", flush=True)
    ok_count = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="CrawlWorker") as pool:
        futures = [pool.submit(execute_source_job, src) for src in due_sources]
        for fut in as_completed(futures):
            _, ok, _ = fut.result()
            if ok:
                ok_count += 1

    print(f"[Scheduler] Completed: {ok_count}/{len(due_sources)} source(s) succeeded.", flush=True)
    return 0 if ok_count > 0 else 1


def run_queue_worker_forever():
    """Stateless distributed worker mode (`python scheduler.py --worker`)."""
    import redis
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379")
    r = redis.from_url(redis_url)
    print(f"[CrawlQueueWorker] Listening on Redis {redis_url}...", flush=True)
    while True:
        item = r.blpop("pricehawk:queue:crawl_jobs", timeout=15)
        if not item:
            continue
        _, payload = item
        source = json.loads(payload)
        execute_source_job(source)


if __name__ == "__main__":
    if "--worker" in sys.argv:
        run_queue_worker_forever()
    else:
        sys.exit(run_scheduler_cycle())
