#!/usr/bin/env python3
"""
dynamic_worker.py — Resource-Blocked Headless Playwright & TLS-Impersonation Worker.

Consumes JS-heavy / anti-bot URLs escalated into Redis `pricehawk:queue:dynamic_render`
by `UniversalCatalogSpider` (when `render_mode == 'auto_escalate'`).

Key Optimizations to Prevent RAM Exhaustion:
  1. Tries ultra-lightweight `curl_cffi` Chrome TLS fingerprint impersonation FIRST (~5MB RAM).
  2. Launches a SINGLE shared Chromium instance ONLY when needed, blocking all `image`,
     `media`, `font`, `stylesheet`, and ad/analytics domains (cuts RAM by ~70% and speeds render 5x).
  3. Runs `UniversalExtractor` + `AISelectorHealer` -> `NormalizePhonePipeline` -> `BatchDBProcessor`.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))

from price_hawk.db_batch_processor import BatchDBProcessor
from price_hawk.extractors import AISelectorHealer, UniversalExtractor
from price_hawk.pipelines import NormalizePhonePipeline

BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet", "other"}
BLOCKED_DOMAIN_KEYWORDS = (
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "facebook.net",
    "tiktok.com",
    "hotjar.com",
    "clarity.ms",
)


def should_abort_request(resource_type: str, url: str) -> bool:
    if resource_type in BLOCKED_RESOURCE_TYPES:
        return True
    lower = url.lower()
    return any(d in lower for d in BLOCKED_DOMAIN_KEYWORDS)


def try_tls_impersonation_fetch(url: str) -> Optional[str]:
    """Tier 1.5: Bypass TLS/JA3 fingerprint blocks without launching a browser."""
    try:
        from curl_cffi import requests as cffi_requests
        resp = cffi_requests.get(url, impersonate="chrome124", timeout=12)
        if resp.status_code == 200 and len(resp.text) > 500:
            return resp.text
    except Exception:
        pass
    return None


class DynamicBrowserRenderer:
    def __init__(self):
        self._playwright = None
        self._browser = None

    async def render_html(self, url: str, wait_ms: int = 1800) -> Optional[str]:
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            print("[DynamicWorker] Playwright not installed in this container.", flush=True)
            return None

        if self._browser is None:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--single-process",
                    "--js-flags=--max-old-space-size=128",
                ],
            )

        context = await self._browser.new_context(
            locale="vi-VN",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        async def _route_interceptor(route):
            req = route.request
            if should_abort_request(req.resource_type, req.url):
                await route.abort()
            else:
                await route.continue_()

        await page.route("**/*", _route_interceptor)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(wait_ms)
            return await page.content()
        except Exception as e:
            print(f"[DynamicWorker] Render failed ({url}): {e}", flush=True)
            return None
        finally:
            await context.close()

    async def close(self):
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None


async def process_escalated_task(
    task: Dict[str, Any],
    renderer: DynamicBrowserRenderer,
    healer: AISelectorHealer,
    normalizer: NormalizePhonePipeline,
    db_writer: BatchDBProcessor,
) -> bool:
    url = task.get("url")
    source = task.get("source") or "universal"
    domain = task.get("domain") or ""
    selectors = task.get("selectors") or {}
    if not url:
        return False

    # Step 1: Try lightweight TLS fingerprint impersonation first
    html = try_tls_impersonation_fetch(url)
    extracted = UniversalExtractor.extract(html, url=url, custom_selectors=selectors) if html else {}

    # Step 2: Escalate to resource-blocked headless Chromium only if still missing price
    if not (extracted.get("name") and extracted.get("price")):
        html = await renderer.render_html(url)
        if not html:
            return False
        extracted = UniversalExtractor.extract(html, url=url, custom_selectors=selectors)

    # Step 3: Self-heal CSS selectors via Groq LLM if DOM rendered but selectors changed
    if not (extracted.get("name") and extracted.get("price")) and domain and healer.can_attempt(domain):
        healed = healer.discover_selectors(domain, html, url=url)
        if healed:
            selectors.update(healed)
            db_writer.save_healed_selectors(source, selectors)
            extracted = UniversalExtractor.extract(html, url=url, custom_selectors=selectors)

    if not (extracted.get("name") and extracted.get("price")):
        return False

    item = normalizer.process_item(
        {
            "source": source,
            "name": extracted["name"],
            "brand": extracted.get("brand"),
            "price": extracted["price"],
            "in_stock": extracted.get("in_stock", True),
            "product_url": url,
            "image_url": extracted.get("image_url"),
            "description": extracted.get("description"),
            "category_path_raw": extracted.get("category_hint") or task.get("category"),
        }
    )
    db_writer.add_item(dict(item))
    return True


async def run_worker_loop():
    import redis

    redis_url = os.getenv("REDIS_URL", "redis://redis:6379")
    r = redis.from_url(redis_url)
    renderer = DynamicBrowserRenderer()
    healer = AISelectorHealer()
    normalizer = NormalizePhonePipeline()
    db_writer = BatchDBProcessor(batch_size=25)

    print(f"[DynamicWorker] Ready on {redis_url} (queue=pricehawk:queue:dynamic_render)", flush=True)
    idle_ticks = 0

    try:
        while True:
            popped = r.blpop("pricehawk:queue:dynamic_render", timeout=10)
            if not popped:
                idle_ticks += 1
                db_writer.flush()
                # Release Chromium RAM when queue has been idle for 60s
                if idle_ticks >= 6:
                    await renderer.close()
                    idle_ticks = 0
                continue

            idle_ticks = 0
            _, raw_payload = popped
            task = json.loads(raw_payload)
            await process_escalated_task(task, renderer, healer, normalizer, db_writer)
    finally:
        db_writer.close()
        await renderer.close()


if __name__ == "__main__":
    asyncio.run(run_worker_loop())
