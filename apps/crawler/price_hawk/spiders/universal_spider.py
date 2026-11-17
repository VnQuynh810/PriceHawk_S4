"""
universal_spider.py — Config-Driven Multi-Website Universal E-commerce Spider.

Capable of crawling dozens of diverse Vietnamese e-commerce websites WITHOUT writing
per-site Python code. Supports:
  - `sitemap`: XML Sitemap & SitemapIndex (.xml & .xml.gz) + robots.txt discovery + <lastmod> diff
  - `html_listing`: Category pagination + link regex/CSS extraction
  - `json_api`: REST JSON pagination with dot-path field mapping
  - `playwright_listing`: Dynamic JS listing marker + auto-escalation to Redis render queue
"""

import gzip
import hashlib
import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin, urlparse

import scrapy
from scrapy.http import Response, TextResponse

from price_hawk.extractors import AISelectorHealer, UniversalExtractor, parse_vnd_price
from price_hawk.items import PhoneItem
from price_hawk.normalizer import canonicalize_url


def _get_dot_path(obj: Any, path: Optional[str]) -> Any:
    if not obj or not path:
        return None
    cur = obj
    for part in str(path).split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if 0 <= idx < len(cur) else None
        else:
            return None
    return cur


class UniversalCatalogSpider(scrapy.Spider):
    name = "universal_catalog"

    def __init__(
        self,
        config_json: Optional[str] = None,
        source: Optional[str] = None,
        domain: Optional[str] = None,
        start_url: Optional[str] = None,
        discovery_mode: str = "sitemap",
        category: Optional[str] = None,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)

        cfg: Dict[str, Any] = json.loads(config_json) if config_json else {}
        self.source_code: str = (cfg.get("code") or source or "universal").strip().lower()
        self.domain: str = (
            cfg.get("domain")
            or domain
            or (urlparse(start_url).hostname if start_url else "")
            or ""
        ).lower().replace("www.", "")

        if self.domain:
            self.allowed_domains = [self.domain, f"www.{self.domain}"]

        raw_urls = cfg.get("start_urls") or ([start_url] if start_url else [])
        if isinstance(raw_urls, str):
            try:
                raw_urls = json.loads(raw_urls)
            except Exception:
                raw_urls = [raw_urls]
        self.entry_urls: List[str] = [u for u in raw_urls if isinstance(u, str) and u.strip()]

        self.discovery_mode: str = cfg.get("discovery_mode") or discovery_mode or "sitemap"
        self.render_mode: str = cfg.get("render_mode") or "auto_escalate"
        self.default_category: Optional[str] = cfg.get("default_category") or category
        self.max_items: int = int(cfg.get("max_items_per_run") or 1500)
        self.proxy_url: Optional[str] = cfg.get("proxy_url") or None

        inc = cfg.get("url_include_pattern")
        exc = cfg.get("url_exclude_pattern")
        self.include_re = re.compile(inc, re.IGNORECASE) if inc else None
        self.exclude_re = re.compile(exc, re.IGNORECASE) if exc else None

        sel_cfg = cfg.get("selectors_json") or {}
        if isinstance(sel_cfg, str):
            try:
                sel_cfg = json.loads(sel_cfg)
            except Exception:
                sel_cfg = {}
        self.selectors: Dict[str, Any] = sel_cfg if isinstance(sel_cfg, dict) else {}

        # Known sitemap <lastmod> map injected by scheduler for incremental crawling
        self.known_lastmod: Dict[str, str] = cfg.get("known_lastmod") or {}
        self.updated_url_states: List[tuple] = []

        self.seen_urls: set[str] = set()
        self.crawled_count: int = 0
        self.escalated_urls: List[str] = []
        self.healer = AISelectorHealer()
        self.healed_selectors: Optional[Dict[str, str]] = None

    def _req_meta(self, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        meta: Dict[str, Any] = {"handle_httpstatus_list": [403, 429, 503]}
        if self.proxy_url:
            meta["proxy"] = self.proxy_url
        if self.render_mode == "playwright":
            meta["playwright"] = True
        if extra:
            meta.update(extra)
        return meta

    def start_requests(self) -> Iterable[scrapy.Request]:
        if not self.entry_urls and self.domain:
            # Auto-discover sitemaps from robots.txt when no start_urls provided
            yield scrapy.Request(
                f"https://{self.domain}/robots.txt",
                callback=self.parse_robots,
                meta=self._req_meta(),
            )
            return

        for url in self.entry_urls:
            if self.discovery_mode == "sitemap":
                yield scrapy.Request(url, callback=self.parse_sitemap, meta=self._req_meta())
            elif self.discovery_mode == "json_api":
                yield scrapy.Request(
                    url,
                    callback=self.parse_json_api,
                    meta=self._req_meta({"api_page": 1}),
                )
            else:
                yield scrapy.Request(
                    url,
                    callback=self.parse_listing,
                    meta=self._req_meta({"listing_page": 1}),
                )

    def parse_robots(self, response: Response):
        found_sitemap = False
        for line in response.text.splitlines():
            if line.lower().startswith("sitemap:"):
                sm_url = line.split(":", 1)[1].strip()
                if sm_url:
                    found_sitemap = True
                    yield scrapy.Request(sm_url, callback=self.parse_sitemap, meta=self._req_meta())
        if not found_sitemap and self.domain:
            yield scrapy.Request(
                f"https://{self.domain}/sitemap.xml",
                callback=self.parse_sitemap,
                meta=self._req_meta(),
            )

    def parse_sitemap(self, response: Response):
        xml_text = self._decode_sitemap_body(response)
        if not xml_text:
            return

        sel = scrapy.Selector(text=xml_text, type="xml")

        # 1. Nested <sitemapindex>
        child_sitemaps = sel.xpath("//*[local-name()='sitemap']/*[local-name()='loc']/text()").getall()
        if child_sitemaps:
            for sm_loc in child_sitemaps:
                sm_url = sm_loc.strip()
                if self.exclude_re and self.exclude_re.search(sm_url):
                    continue
                if sm_url not in self.seen_urls:
                    self.seen_urls.add(sm_url)
                    yield scrapy.Request(sm_url, callback=self.parse_sitemap, meta=self._req_meta())
            return

        # 2. Leaf <urlset> with optional <lastmod> incremental filtering
        for url_node in sel.xpath("//*[local-name()='url']"):
            if self.crawled_count >= self.max_items:
                break
            loc = (url_node.xpath("./*[local-name()='loc']/text()").get() or "").strip()
            if not loc:
                continue
            lastmod = (url_node.xpath("./*[local-name()='lastmod']/text()").get() or "").strip() or None

            clean_url = canonicalize_url(urljoin(response.url, loc)) or loc
            if not self._is_candidate_product_url(clean_url):
                continue
            if clean_url in self.seen_urls:
                continue

            url_hash = hashlib.sha256(clean_url.encode("utf-8")).hexdigest()
            if lastmod and self.known_lastmod.get(url_hash) == lastmod:
                # Incremental skip: page hasn't changed since last crawl!
                continue

            self.seen_urls.add(clean_url)
            yield scrapy.Request(
                clean_url,
                callback=self.parse_detail,
                meta=self._req_meta({"sitemap_lastmod": lastmod, "url_hash": url_hash}),
            )

    def parse_listing(self, response: Response):
        if response.status in (403, 429, 503):
            self._escalate_url(response.url)
            return

        link_css = self.selectors.get("listing_link_css") or "a::attr(href)"
        hrefs = response.css(link_css).getall()

        for href in hrefs:
            if self.crawled_count >= self.max_items:
                return
            full_url = canonicalize_url(urljoin(response.url, href))
            if not full_url or full_url in self.seen_urls:
                continue
            if self._is_candidate_product_url(full_url):
                self.seen_urls.add(full_url)
                yield scrapy.Request(full_url, callback=self.parse_detail, meta=self._req_meta())

        # Follow pagination up to configured max_pages
        current_page = int(response.meta.get("listing_page") or 1)
        max_pages = int(self.selectors.get("max_pages") or 15)
        if current_page < max_pages:
            next_href = (
                response.css("a[rel='next']::attr(href), a.next::attr(href), li.next a::attr(href)").get()
            )
            if not next_href and self.selectors.get("pagination_param"):
                param = self.selectors["pagination_param"]
                sep = "&" if "?" in self.entry_urls[0] else "?"
                next_href = f"{self.entry_urls[0]}{sep}{param}={current_page + 1}"

            if next_href:
                next_url = urljoin(response.url, next_href)
                if next_url not in self.seen_urls:
                    self.seen_urls.add(next_url)
                    yield scrapy.Request(
                        next_url,
                        callback=self.parse_listing,
                        meta=self._req_meta({"listing_page": current_page + 1}),
                    )

    def parse_json_api(self, response: Response):
        try:
            payload = json.loads(response.text)
        except Exception:
            return

        items_path = self.selectors.get("items_path", "data")
        items = _get_dot_path(payload, items_path)
        if not isinstance(items, list):
            return

        name_path = self.selectors.get("name_path", "name")
        price_path = self.selectors.get("price_path", "price")
        url_path = self.selectors.get("url_path", "url")
        img_path = self.selectors.get("image_path", "image")
        brand_path = self.selectors.get("brand_path", "brand")

        for row in items:
            if self.crawled_count >= self.max_items:
                break
            name = _get_dot_path(row, name_path)
            price = parse_vnd_price(_get_dot_path(row, price_path))
            raw_url = _get_dot_path(row, url_path)
            if not (name and price and raw_url):
                continue

            full_url = canonicalize_url(urljoin(f"https://{self.domain}/", str(raw_url)))
            img = _get_dot_path(row, img_path)
            if isinstance(img, str) and img:
                img = urljoin(f"https://{self.domain}/", img)

            self.crawled_count += 1
            yield PhoneItem(
                source=self.source_code,
                product_id=full_url.rstrip("/").split("/")[-1],
                name=str(name).strip(),
                brand=_get_dot_path(row, brand_path),
                model=str(name).strip(),
                variant=None,
                price=price,
                in_stock=True,
                product_url=full_url,
                image_url=img if isinstance(img, str) else None,
                description=None,
                category_path_raw=self._infer_category_from_url(full_url),
            )

    def parse_detail(self, response: Response):
        if self.crawled_count >= self.max_items:
            return

        if response.status in (403, 429, 503) or not isinstance(response, TextResponse):
            self._escalate_url(response.url)
            return

        extracted = UniversalExtractor.extract(
            response.text,
            url=response.url,
            custom_selectors=self.selectors,
        )

        # Stage 5: Self-Healing Selector Discovery via Groq LLM (once per domain)
        if not (extracted.get("name") and extracted.get("price")) and not extracted.get("needs_js_render"):
            if self.healer.can_attempt(self.domain):
                healed = self.healer.discover_selectors(self.domain, response.text, url=response.url)
                if healed:
                    self.selectors.update(healed)
                    self.healed_selectors = dict(self.selectors)
                    extracted = UniversalExtractor.extract(
                        response.text,
                        url=response.url,
                        custom_selectors=self.selectors,
                    )

        if not (extracted.get("name") and extracted.get("price")):
            if self.render_mode == "auto_escalate" and extracted.get("needs_js_render"):
                self._escalate_url(response.url)
            return

        clean_url = canonicalize_url(response.url) or response.url
        lastmod = response.meta.get("sitemap_lastmod")
        url_hash = response.meta.get("url_hash")
        if url_hash and lastmod:
            self.updated_url_states.append((url_hash, self.source_code, clean_url, lastmod))

        cat_hint = (
            extracted.get("category_hint")
            or self._infer_category_from_url(clean_url)
            or self.default_category
        )

        self.crawled_count += 1
        yield PhoneItem(
            source=self.source_code,
            product_id=clean_url.rstrip("/").split("/")[-1],
            name=extracted["name"],
            brand=extracted.get("brand"),
            model=extracted["name"],
            variant=None,
            price=extracted["price"],
            in_stock=extracted.get("in_stock", True),
            product_url=clean_url,
            image_url=extracted.get("image_url"),
            description=extracted.get("description"),
            category_path_raw=cat_hint,
        )

    def _is_candidate_product_url(self, url: str) -> bool:
        parsed = urlparse(url)
        if self.domain and parsed.hostname and self.domain not in parsed.hostname.lower():
            return False
        path_lower = parsed.path.lower()
        if path_lower in ("", "/"):
            return False
        if any( path_lower.endswith(ext) for ext in (".jpg", ".png", ".webp", ".svg", ".pdf", ".xml", ".gz") ):
            return False
        if self.exclude_re and self.exclude_re.search(url):
            return False
        if self.include_re and not self.include_re.search(url):
            return False
        return True

    def _infer_category_from_url(self, url: str) -> Optional[str]:
        lower = url.lower()
        if any(k in lower for k in ("laptop", "macbook", "may-tinh-xach-tay", "notebook")):
            return "laptop"
        if any(k in lower for k in ("tablet", "ipad", "may-tinh-bang", "galaxy-tab")):
            return "tablet"
        if any(k in lower for k in ("dien-thoai", "dtdd", "iphone", "smartphone", "mobile")):
            return "dien-thoai"
        return self.default_category

    def _escalate_url(self, url: str):
        if self.render_mode != "auto_escalate":
            return
        if len(self.escalated_urls) < 200:
            self.escalated_urls.append(url)
            redis_url = os.getenv("REDIS_URL")
            if redis_url:
                try:
                    import redis
                    r = redis.from_url(redis_url, socket_connect_timeout=1.5)
                    payload = json.dumps(
                        {
                            "url": url,
                            "source": self.source_code,
                            "domain": self.domain,
                            "category": self.default_category,
                            "selectors": self.selectors,
                        }
                    )
                    r.lpush("pricehawk:queue:dynamic_render", payload)
                except Exception:
                    pass

    @staticmethod
    def _decode_sitemap_body(response: Response) -> str:
        body = response.body or b""
        if body[:2] == b"\x1f\x8b" or response.url.lower().endswith(".gz"):
            try:
                return gzip.decompress(body).decode("utf-8", errors="replace")
            except Exception:
                return ""
        return response.text if isinstance(response, TextResponse) else body.decode("utf-8", errors="replace")
