import gzip
import hashlib
import json
from unittest.mock import MagicMock, patch

import pytest
from scrapy.http import HtmlResponse, Request, Response, TextResponse, XmlResponse

from dynamic_worker import should_abort_request
from price_hawk.extractors import AISelectorHealer, UniversalExtractor, parse_vnd_price
from price_hawk.spiders.cellphones_spider import CellphoneSCatalogSpider
from price_hawk.spiders.universal_spider import UniversalCatalogSpider


# ── 1. Universal 5-Stage Waterfall Extractor Tests ────────────────────────────


def test_parse_vnd_price_variants():
    assert parse_vnd_price("17.990.000₫") == 17_990_000
    assert parse_vnd_price("24,490,000 đ") == 24_490_000
    assert parse_vnd_price("18990000.00") == 18_990_000
    assert parse_vnd_price(12500000) == 12_500_000
    assert parse_vnd_price("Liên hệ") is None
    assert parse_vnd_price("0") is None


def test_extractor_stage_json_ld_graph_and_stock():
    html = """
    <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "WebSite", "name": "TechShop"},
          {
            "@type": "Product",
            "name": "iPhone 16 Pro Max 256GB Sa Mạc",
            "brand": {"@type": "Brand", "name": "Apple"},
            "image": ["/img/ip16.jpg"],
            "offers": {
              "@type": "AggregateOffer",
              "lowPrice": "32.490.000",
              "highPrice": "34.990.000",
              "availability": "https://schema.org/OutOfStock"
            }
          }
        ]
      }
      </script>
    </head><body></body></html>
    """
    res = UniversalExtractor.extract(html, url="https://didongviet.vn/iphone-16-pro-max.html")
    assert res["strategy"] == "json_ld"
    assert res["name"] == "iPhone 16 Pro Max 256GB Sa Mạc"
    assert res["price"] == 32_490_000
    assert res["brand"] == "Apple"
    assert res["image_url"] == "https://didongviet.vn/img/ip16.jpg"
    assert res["in_stock"] is False


def test_extractor_stage_nextjs_hydration_json_without_browser():
    next_payload = {
        "props": {
            "pageProps": {
                "productDetail": {
                    "productName": "Laptop MacBook Air M3 16GB 512GB",
                    "salePrice": 28990000,
                    "brandName": "Apple",
                    "imageUrl": "https://cdn.phongvu.vn/mba-m3.webp",
                }
            }
        }
    }
    html = f"""
    <html><body>
      <div id="__next"></div>
      <script id="__NEXT_DATA__" type="application/json">{json.dumps(next_payload)}</script>
    </body></html>
    """
    res = UniversalExtractor.extract(html, url="https://phongvu.vn/macbook-air-m3-s2401")
    assert res["strategy"] == "hydration_json"
    assert res["name"] == "Laptop MacBook Air M3 16GB 512GB"
    assert res["price"] == 28_990_000
    assert res["brand"] == "Apple"
    assert res["needs_js_render"] is False


def test_extractor_stage_opengraph_and_heuristic_dom():
    og_html = """
    <html><head>
      <meta property="og:title" content="Samsung Galaxy Tab S10 12GB 256GB" />
      <meta property="product:price:amount" content="19490000" />
      <meta property="og:image" content="https://gearvn.com/tab-s10.png" />
    </head><body></body></html>
    """
    og_res = UniversalExtractor.extract(og_html)
    assert og_res["strategy"] == "opengraph_microdata"
    assert og_res["price"] == 19_490_000

    dom_html = """
    <html><body>
      <h1>Xiaomi 14T Pro 12GB 512GB Đen</h1>
      <div class="product-price"><span class="price">15.990.000 ₫</span></div>
    </body></html>
    """
    dom_res = UniversalExtractor.extract(dom_html)
    assert dom_res["strategy"] == "heuristic_dom"
    assert dom_res["name"] == "Xiaomi 14T Pro 12GB 512GB Đen"
    assert dom_res["price"] == 15_990_000


def test_extractor_detects_spa_shell_and_cloudflare_challenge():
    spa_shell = """
    <html><head>
      <script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>
    </head><body><div id="root"></div></body></html>
    """
    spa_res = UniversalExtractor.extract(spa_shell)
    assert spa_res["price"] is None
    assert spa_res["needs_js_render"] is True

    cf_html = "<html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>"
    cf_res = UniversalExtractor.extract(cf_html)
    assert cf_res["strategy"] == "blocked_challenge"
    assert cf_res["needs_js_render"] is True


# ── 2. AI Selector Auto-Healer Tests ──────────────────────────────────────────


def test_ai_selector_healer_verifies_and_rate_limits():
    unusual_html = """
    <html><body>
      <div class="custom-sku-header">ASUS ROG Zephyrus G16 32GB 1TB</div>
      <div class="weird-vnd-tag">54.990.000đ</div>
    </body></html>
    """
    healer = AISelectorHealer(api_key="fake-groq-key")

    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "name_css": "div.custom-sku-header",
                            "price_css": "div.weird-vnd-tag",
                        }
                    )
                }
            }
        ]
    }

    with patch("price_hawk.extractors.ai_selector_healer.requests.post", return_value=mock_resp) as post_mock:
        discovered = healer.discover_selectors("newshop.vn", unusual_html)
        assert discovered == {
            "name_css": "div.custom-sku-header",
            "price_css": "div.weird-vnd-tag",
        }
        # Second call on the same domain must be skipped (cooldown rate limit)
        assert healer.can_attempt("newshop.vn") is False
        assert healer.discover_selectors("newshop.vn", unusual_html) is None
        assert post_mock.call_count == 1


# ── 3. UniversalCatalogSpider (Sitemap, Gzip, <lastmod>, HTML, JSON, Escalate) ─


def test_universal_spider_sitemap_index_and_incremental_lastmod():
    unchanged_url = "https://didongviet.vn/dien-thoai/iphone-15.html"
    changed_url = "https://didongviet.vn/dien-thoai/iphone-16.html"
    blog_url = "https://didongviet.vn/tin-tuc/review-iphone-16.html"

    unchanged_hash = hashlib.sha256(unchanged_url.encode("utf-8")).hexdigest()

    cfg = {
        "code": "didongviet",
        "domain": "didongviet.vn",
        "discovery_mode": "sitemap",
        "start_urls": ["https://didongviet.vn/sitemap.xml"],
        "url_include_pattern": "iphone",
        "url_exclude_pattern": "tin-tuc",
        "known_lastmod": {unchanged_hash: "2026-05-01"},
    }
    spider = UniversalCatalogSpider(config_json=json.dumps(cfg))

    # 3a. Parse <sitemapindex>
    sm_index_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://didongviet.vn/sitemap-products.xml.gz</loc></sitemap>
      <sitemap><loc>https://didongviet.vn/sitemap-tin-tuc.xml</loc></sitemap>
    </sitemapindex>"""
    idx_resp = XmlResponse(url="https://didongviet.vn/sitemap.xml", body=sm_index_xml.encode("utf-8"))
    child_reqs = list(spider.parse_sitemap(idx_resp))
    assert len(child_reqs) == 1
    assert child_reqs[0].url == "https://didongviet.vn/sitemap-products.xml.gz"

    # 3b. Parse gzipped child <urlset> with <lastmod> diffing
    leaf_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>{unchanged_url}</loc><lastmod>2026-05-01</lastmod></url>
      <url><loc>{changed_url}?utm_source=gg</loc><lastmod>2026-06-01</lastmod></url>
      <url><loc>{blog_url}</loc><lastmod>2026-06-01</lastmod></url>
    </urlset>"""
    gz_body = gzip.compress(leaf_xml.encode("utf-8"))
    gz_resp = Response(url="https://didongviet.vn/sitemap-products.xml.gz", body=gz_body)
    detail_reqs = list(spider.parse_sitemap(gz_resp))

    # Only changed_url (canonicalized without ?utm_source) should be scheduled!
    assert len(detail_reqs) == 1
    assert detail_reqs[0].url == changed_url


def test_universal_spider_json_api_and_auto_escalation():
    api_cfg = {
        "code": "apishop",
        "domain": "apishop.vn",
        "discovery_mode": "json_api",
        "start_urls": ["https://apishop.vn/api/v1/items"],
        "selectors_json": {
            "items_path": "result.items",
            "name_path": "title",
            "price_path": "final_price",
            "url_path": "slug",
        },
    }
    spider = UniversalCatalogSpider(config_json=json.dumps(api_cfg))
    api_payload = {
        "result": {
            "items": [
                {"title": "iPad Pro M4 256GB", "final_price": 26990000, "slug": "/tablet/ipad-pro-m4"}
            ]
        }
    }
    resp = TextResponse(
        url="https://apishop.vn/api/v1/items",
        body=json.dumps(api_payload).encode("utf-8"),
    )
    items = list(spider.parse_json_api(resp))
    assert len(items) == 1
    assert items[0]["name"] == "iPad Pro M4 256GB"
    assert items[0]["price"] == 26_990_000
    assert items[0]["product_url"] == "https://apishop.vn/tablet/ipad-pro-m4"

    # Auto-escalation on empty SPA shell
    spa_resp = HtmlResponse(
        url="https://apishop.vn/dien-thoai/spa-item",
        body=b"<html><head><script src='/1.js'></script><script src='/2.js'></script><script src='/3.js'></script></head><body><div id='root'></div></body></html>",
        request=Request("https://apishop.vn/dien-thoai/spa-item"),
    )
    list(spider.parse_detail(spa_resp))
    assert "https://apishop.vn/dien-thoai/spa-item" in spider.escalated_urls


def test_cellphones_multi_category_and_dynamic_worker_resource_blocker():
    laptop_spider = CellphoneSCatalogSpider(category="laptop")
    assert laptop_spider.category_id == "380"
    tablet_spider = CellphoneSCatalogSpider(category="tablet")
    assert tablet_spider.category_id == "4"

    assert should_abort_request("image", "https://cdn.shop.vn/banner.png") is True
    assert should_abort_request("font", "https://fonts.gstatic.com/f.woff2") is True
    assert should_abort_request("script", "https://www.google-analytics.com/analytics.js") is True
    assert should_abort_request("script", "https://shop.vn/_next/static/chunks/main.js") is False
    assert should_abort_request("xhr", "https://shop.vn/api/price?id=1") is False
