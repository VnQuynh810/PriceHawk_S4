#!/usr/bin/env python3
"""
Parallel Spider Orchestrator for PriceHawk Crawler.
Runs all active shops (tgdd, fpt, hoangha) across categories (dien-thoai, laptop, tablet)
without dumping unbounded .jsonl files to disk.
"""

import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]

SPIDER_BY_SHOP = {
    "tgdd": "tgdd_catalog",
    "fpt": "fpt_catalog",
    "hoangha": "hoangha_catalog",
}

CATEGORIES = ["dien-thoai", "laptop", "tablet"]
MAX_WORKERS = max(1, min(4, int(os.getenv("CRAWLER_MAX_WORKERS", "2"))))


def run_spider(shop: str, category: str) -> tuple[str, str, bool]:
    spider_name = SPIDER_BY_SHOP[shop]
    cmd = [
        sys.executable,
        "-m",
        "scrapy",
        "crawl",
        spider_name,
        "-a",
        f"category={category}",
        "-s",
        "LOG_LEVEL=WARNING",
    ]

    thread_id = threading.current_thread().name
    start = time.time()

    try:
        result = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=300,
        )
        elapsed = time.time() - start
        success = result.returncode == 0
        if success:
            print(f"[{thread_id}] OK {shop}:{category} ({elapsed:.1f}s)", flush=True)
        else:
            print(f"[{thread_id}] FAIL {shop}:{category} ({elapsed:.1f}s)", flush=True)
            if result.stderr.strip():
                print(result.stderr.strip()[-500:], flush=True)
        return (shop, category, success)
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        print(f"[{thread_id}] TIMEOUT {shop}:{category} ({elapsed:.1f}s)", flush=True)
        return (shop, category, False)
    except Exception as e:
        print(f"[{thread_id}] ERROR {shop}:{category}: {e}", flush=True)
        return (shop, category, False)


def main() -> int:
    tasks = [(shop, cat) for shop in SPIDER_BY_SHOP for cat in CATEGORIES]
    print(
        f"[PriceHawk Crawler] Starting {len(tasks)} spiders with {MAX_WORKERS} worker(s)...",
        flush=True,
    )

    successful = 0
    failed = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="Spider") as executor:
        futures = {executor.submit(run_spider, s, c): (s, c) for s, c in tasks}
        for future in as_completed(futures):
            _, _, ok = future.result()
            if ok:
                successful += 1
            else:
                failed += 1

    total_time = time.time() - start_time
    print(
        f"[PriceHawk Crawler] Cycle complete: {successful} succeeded, {failed} failed in {total_time:.1f}s",
        flush=True,
    )
    return 0 if successful > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
