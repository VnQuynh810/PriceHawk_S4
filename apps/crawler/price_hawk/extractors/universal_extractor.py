"""
universal_extractor.py — 5-Stage Waterfall Product Extractor for Vietnamese E-commerce.

Stages:
  1. Custom / AI-Healed CSS or XPath Selectors (from crawl_source.selectors_json)
  2. Schema.org JSON-LD (@type=Product / AggregateOffer / @graph)
  3. SPA Hydration State (__NEXT_DATA__, __NUXT__, window.__INITIAL_STATE__)
  4. OpenGraph & HTML5 Microdata (product:price:amount, itemprop="price", og:title)
  5. Heuristic Vietnamese E-commerce DOM Price/Title Scanner
"""

import json
import re
from typing import Any, Dict, Optional
from urllib.parse import urljoin
from scrapy.selector import Selector

MIN_REALISTIC_VND = 50_000
MAX_REALISTIC_VND = 500_000_000

CHALLENGE_MARKERS = (
    "cf-browser-verification",
    "challenge-platform",
    "just a moment...",
    "enable javascript and cookies to continue",
    "attention required! | cloudflare",
)

OUT_OF_STOCK_TOKENS = (
    "outofstock",
    "soldout",
    "discontinued",
    "hết hàng",
    "tạm hết hàng",
    "ngừng kinh doanh",
)

PRICE_JSON_KEYS = (
    "special_price",
    "salePrice",
    "sale_price",
    "finalPrice",
    "final_price",
    "discountedPrice",
    "promotionPrice",
    "currentPrice",
    "current_price",
    "lowPrice",
    "minPrice",
    "price",
)

NAME_JSON_KEYS = ("name", "productName", "product_name", "title", "fullName")
IMAGE_JSON_KEYS = ("image", "imageUrl", "image_url", "thumbnail", "thumb", "avatar")


def clean_space(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned or None


def parse_vnd_price(raw: Any) -> Optional[int]:
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        val = int(round(float(raw)))
        return val if MIN_REALISTIC_VND <= val <= MAX_REALISTIC_VND else None

    text = str(raw).strip()
    if not text:
        return None
    lower = text.lower()
    if "liên hệ" in lower or "lien he" in lower:
        return None

    # Handle decimal suffix like "17990000.00" vs Vietnamese thousand separators "17.990.000"
    if re.match(r"^\d+\.\d{1,2}$", text):
        val = int(round(float(text)))
        return val if MIN_REALISTIC_VND <= val <= MAX_REALISTIC_VND else None

    # Extract first contiguous price token like 17.990.000 or 17,990,000
    m = re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d{5,9})", text)
    if not m:
        return None
    digits = re.sub(r"[^0-9]", "", m.group(1))
    if not digits:
        return None
    val = int(digits)
    return val if MIN_REALISTIC_VND <= val <= MAX_REALISTIC_VND else None


class UniversalExtractor:
    @classmethod
    def extract(
        cls,
        html: str,
        url: str = "",
        custom_selectors: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        if not html or not html.strip():
            return cls._empty_result(needs_js_render=True)

        lower_html = html[:8000].lower()
        if any(marker in lower_html for marker in CHALLENGE_MARKERS):
            return cls._empty_result(needs_js_render=True, strategy="blocked_challenge")

        sel = Selector(text=html)
        merged: Dict[str, Any] = {
            "name": None,
            "price": None,
            "brand": None,
            "image_url": None,
            "description": None,
            "in_stock": True,
            "category_hint": cls._extract_breadcrumb(sel),
            "strategy": None,
            "needs_js_render": False,
        }

        # Stage 1: Custom / AI-Healed Selectors
        if custom_selectors:
            s1 = cls._extract_by_selectors(sel, custom_selectors, url)
            cls._merge(merged, s1, "custom_selectors")

        # Stage 2: Schema.org JSON-LD
        if not (merged["name"] and merged["price"]):
            s2 = cls._extract_json_ld(sel, url)
            cls._merge(merged, s2, "json_ld")

        # Stage 3: Next.js / Nuxt / SPA Hydration JSON
        if not (merged["name"] and merged["price"]):
            s3 = cls._extract_hydration_json(sel, url)
            cls._merge(merged, s3, "hydration_json")

        # Stage 4: OpenGraph & HTML5 Microdata
        if not (merged["name"] and merged["price"]):
            s4 = cls._extract_opengraph_microdata(sel, url)
            cls._merge(merged, s4, "opengraph_microdata")

        # Stage 5: Heuristic Vietnamese DOM Price/Title Scanner
        if not (merged["name"] and merged["price"]):
            s5 = cls._extract_heuristic_dom(sel, url)
            cls._merge(merged, s5, "heuristic_dom")

        # Detect SPA empty shell needing headless JS rendering
        if merged["price"] is None:
            body_text = clean_space(" ".join(sel.css("body *::text").getall())) or ""
            has_spa_root = bool(
                sel.css("#root, #app, #__next").get()
                and len(body_text) < 400
            )
            has_scripts = len(sel.css("script[src]").getall()) >= 3
            if has_spa_root or (has_scripts and merged["name"] is None):
                merged["needs_js_render"] = True

        return merged

    @classmethod
    def _empty_result(cls, needs_js_render: bool = False, strategy: Optional[str] = None) -> Dict[str, Any]:
        return {
            "name": None,
            "price": None,
            "brand": None,
            "image_url": None,
            "description": None,
            "in_stock": True,
            "category_hint": None,
            "strategy": strategy,
            "needs_js_render": needs_js_render,
        }

    @staticmethod
    def _merge(target: Dict[str, Any], candidate: Dict[str, Any], strategy_name: str):
        if not candidate:
            return
        contributed = False
        filled_price = False
        for key in ("name", "price", "brand", "image_url", "description"):
            if target.get(key) is None and candidate.get(key) is not None:
                target[key] = candidate[key]
                if key == "price":
                    filled_price = True
                    contributed = True
                elif key == "name":
                    contributed = True
        if candidate.get("in_stock") is False:
            target["in_stock"] = False
        if filled_price or (contributed and not target.get("strategy")):
            target["strategy"] = strategy_name

    @classmethod
    def _pick_selector(cls, sel: Selector, expr: Optional[str]) -> Optional[str]:
        if not expr:
            return None
        expr = expr.strip()
        if expr.startswith("/") or expr.startswith("("):
            vals = sel.xpath(expr).getall()
        else:
            if "::text" not in expr and "::attr(" not in expr:
                vals = sel.css(f"{expr}::text, {expr} *::text").getall()
            else:
                vals = sel.css(expr).getall()
        joined = clean_space(" ".join(v.strip() for v in vals if v and v.strip()))
        return joined

    @classmethod
    def _extract_by_selectors(cls, sel: Selector, cfg: Dict[str, str], base_url: str) -> Dict[str, Any]:
        name = cls._pick_selector(sel, cfg.get("name_css") or cfg.get("name_xpath"))
        raw_price = cls._pick_selector(sel, cfg.get("price_css") or cfg.get("price_xpath"))
        price = parse_vnd_price(raw_price)
        brand = cls._pick_selector(sel, cfg.get("brand_css"))

        img = None
        img_expr = cfg.get("image_css")
        if img_expr:
            if "::attr(" in img_expr:
                img = clean_space(sel.css(img_expr).get())
            else:
                img = clean_space(
                    sel.css(f"{img_expr}::attr(src), {img_expr}::attr(data-src)").get()
                )
            if img and base_url:
                img = urljoin(base_url, img)

        return {"name": name, "price": price, "brand": brand, "image_url": img}

    @classmethod
    def _extract_json_ld(cls, sel: Selector, base_url: str) -> Dict[str, Any]:
        for raw in sel.css('script[type="application/ld+json"]::text').getall():
            if not raw or not raw.strip():
                continue
            cleaned = re.sub(r",\s*([}\]])", r"\1", raw.strip())
            try:
                payload = json.loads(cleaned)
            except Exception:
                continue

            product = cls._find_ld_product(payload)
            if not product:
                continue

            name = clean_space(product.get("name"))
            brand_node = product.get("brand")
            brand = (
                clean_space(brand_node.get("name"))
                if isinstance(brand_node, dict)
                else clean_space(brand_node)
            )
            img = cls._normalize_image(product.get("image"), base_url)
            desc = clean_space(product.get("description"))

            price, in_stock = cls._parse_ld_offers(product.get("offers"))
            if name or price:
                return {
                    "name": name,
                    "price": price,
                    "brand": brand,
                    "image_url": img,
                    "description": desc,
                    "in_stock": in_stock,
                }
        return {}

    @classmethod
    def _find_ld_product(cls, node: Any) -> Optional[Dict[str, Any]]:
        if isinstance(node, dict):
            t = node.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                return node
            for val in node.values():
                found = cls._find_ld_product(val)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node:
                found = cls._find_ld_product(item)
                if found:
                    return found
        return None

    @classmethod
    def _parse_ld_offers(cls, offers: Any) -> tuple[Optional[int], bool]:
        if not offers:
            return None, True

        offer_list = offers if isinstance(offers, list) else [offers]
        prices = []
        any_in_stock = False
        saw_availability = False

        for off in offer_list:
            if not isinstance(off, dict):
                continue
            for key in ("lowPrice", "price", "highPrice"):
                p = parse_vnd_price(off.get(key))
                if p:
                    prices.append(p)
                    break
            nested = off.get("offers")
            if nested:
                np, nis = cls._parse_ld_offers(nested)
                if np:
                    prices.append(np)
                if nis:
                    any_in_stock = True

            avail = str(off.get("availability") or "").lower()
            if avail:
                saw_availability = True
                if not any(tok in avail for tok in OUT_OF_STOCK_TOKENS):
                    any_in_stock = True

        in_stock = any_in_stock if saw_availability else True
        return (min(prices) if prices else None), in_stock

    @classmethod
    def _extract_hydration_json(cls, sel: Selector, base_url: str) -> Dict[str, Any]:
        candidates = sel.css("script#__NEXT_DATA__::text").getall()
        for script_text in sel.css("script:not([src])::text").getall():
            if "__INITIAL_STATE__" in script_text or "__NUXT__" in script_text:
                m = re.search(r"=\s*(\{.*\})\s*;?\s*$", script_text.strip(), re.DOTALL)
                if m:
                    candidates.append(m.group(1))

        for raw in candidates:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            hit = cls._walk_product_dict(data, base_url)
            if hit and hit.get("name") and hit.get("price"):
                return hit
        return {}

    @classmethod
    def _walk_product_dict(cls, node: Any, base_url: str, depth: int = 0) -> Optional[Dict[str, Any]]:
        if depth > 14:
            return None
        if isinstance(node, dict):
            name = None
            for nk in NAME_JSON_KEYS:
                val = node.get(nk)
                if isinstance(val, str) and 4 <= len(val.strip()) <= 250:
                    name = clean_space(val)
                    break

            price = None
            for pk in PRICE_JSON_KEYS:
                p = parse_vnd_price(node.get(pk))
                if p:
                    price = p
                    break

            if name and price:
                img = None
                for ik in IMAGE_JSON_KEYS:
                    img = cls._normalize_image(node.get(ik), base_url)
                    if img:
                        break
                brand_val = node.get("brand") or node.get("manufacturer") or node.get("brandName")
                brand = (
                    clean_space(brand_val.get("name"))
                    if isinstance(brand_val, dict)
                    else clean_space(brand_val) if isinstance(brand_val, str) else None
                )
                return {"name": name, "price": price, "brand": brand, "image_url": img}

            for v in node.values():
                found = cls._walk_product_dict(v, base_url, depth + 1)
                if found:
                    return found
        elif isinstance(node, list):
            for item in node[:30]:
                found = cls._walk_product_dict(item, base_url, depth + 1)
                if found:
                    return found
        return None

    @classmethod
    def _extract_opengraph_microdata(cls, sel: Selector, base_url: str) -> Dict[str, Any]:
        name = clean_space(
            sel.css("h1::text").get()
            or sel.css('meta[property="og:title"]::attr(content)').get()
            or sel.css('meta[name="title"]::attr(content)').get()
        )
        raw_prices = [
            sel.css('meta[property="product:price:amount"]::attr(content)').get(),
            sel.css('meta[property="og:price:amount"]::attr(content)').get(),
            sel.css('[itemprop="price"]::attr(content)').get(),
            sel.css('[itemprop="lowPrice"]::attr(content)').get(),
            sel.css('[itemprop="price"]::text').get(),
        ]
        price = None
        for rp in raw_prices:
            price = parse_vnd_price(rp)
            if price:
                break

        img = cls._normalize_image(
            sel.css('meta[property="og:image"]::attr(content)').get()
            or sel.css('[itemprop="image"]::attr(src)').get(),
            base_url,
        )
        brand = clean_space(
            sel.css('meta[property="product:brand"]::attr(content)').get()
            or sel.css('[itemprop="brand"] [itemprop="name"]::text').get()
            or sel.css('[itemprop="brand"]::text').get()
        )
        desc = clean_space(
            sel.css('meta[property="og:description"]::attr(content)').get()
            or sel.css('meta[name="description"]::attr(content)').get()
        )
        return {
            "name": name,
            "price": price,
            "brand": brand,
            "image_url": img,
            "description": desc,
        }

    @classmethod
    def _extract_heuristic_dom(cls, sel: Selector, base_url: str) -> Dict[str, Any]:
        h1_texts = sel.css("h1::text, h1 *::text").getall()
        name = clean_space(" ".join(t.strip() for t in h1_texts if t.strip()))

        price_selectors = (
            ".product-price .price",
            ".box-price-present",
            ".price-current",
            ".special-price .price",
            ".product-info__price",
            ".detail-price",
            '[class*="product-price"]',
            '[class*="sale-price"]',
            '[class*="current-price"]',
        )
        price = None
        for css_sel in price_selectors:
            texts = sel.css(f"{css_sel}::text, {css_sel} *::text").getall()
            for t in texts:
                p = parse_vnd_price(t)
                if p:
                    price = p
                    break
            if price:
                break

        body_lower = " ".join(sel.css("body *::text").getall()[:400]).lower()
        in_stock = not any(tok in body_lower for tok in ("hết hàng", "tạm hết hàng", "ngừng kinh doanh"))

        return {"name": name, "price": price, "in_stock": in_stock}

    @staticmethod
    def _extract_breadcrumb(sel: Selector) -> Optional[str]:
        tokens = [
            clean_space(t)
            for t in sel.css(
                "nav[aria-label='breadcrumb'] a::text, .breadcrumb a::text, .breadcrumbs a::text"
            ).getall()
        ]
        tokens = [t for t in tokens if t]
        return " > ".join(tokens) if tokens else None

    @staticmethod
    def _normalize_image(val: Any, base_url: str) -> Optional[str]:
        if not val:
            return None
        if isinstance(val, list):
            for item in val:
                res = UniversalExtractor._normalize_image(item, base_url)
                if res:
                    return res
            return None
        if isinstance(val, dict):
            raw = val.get("url") or val.get("contentUrl") or val.get("src")
            return UniversalExtractor._normalize_image(raw, base_url)
        if isinstance(val, str):
            cleaned = clean_space(val)
            if not cleaned:
                return None
            return urljoin(base_url, cleaned) if base_url else cleaned
        return None
