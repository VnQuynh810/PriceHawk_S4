import json
import math
from urllib.parse import urljoin

import scrapy

from price_hawk.items import PhoneItem
from price_hawk.spiders.utils import (
    clean_space,
    extract_image_url,
    extract_json_ld_product,
    first_non_empty,
)


class CellphoneSCatalogSpider(scrapy.Spider):
    """Multi-category GraphQL + Detail Spider for CellphoneS (Phone, Laptop, Tablet)."""

    name = "cellphones_catalog"
    allowed_domains = ["cellphones.com.vn", "api.cellphones.com.vn"]
    graphql_endpoint = "https://api.cellphones.com.vn/v2/graphql/query"

    CATEGORY_CONFIG = {
        "dien-thoai": {
            "start_url": "https://cellphones.com.vn/mobile.html",
            "category_id": "3",
        },
        "laptop": {
            "start_url": "https://cellphones.com.vn/laptop.html",
            "category_id": "380",
        },
        "tablet": {
            "start_url": "https://cellphones.com.vn/tablet.html",
            "category_id": "4",
        },
    }

    province_id = 30
    page_size = 20
    max_pages = 30

    def __init__(self, *args, **kwargs):
        requested_category = clean_space(kwargs.pop("category", None)) or "dien-thoai"
        super().__init__(*args, **kwargs)

        cat_key = requested_category.strip().lower()
        if cat_key not in self.CATEGORY_CONFIG:
            valid = ", ".join(sorted(self.CATEGORY_CONFIG.keys()))
            raise ValueError(f"Unsupported category '{requested_category}'. Valid: {valid}")

        self.category = cat_key
        cfg = self.CATEGORY_CONFIG[cat_key]
        self.start_urls = [cfg["start_url"]]
        self.category_id = cfg["category_id"]

        self.seen_product_urls = set()
        self.seen_page_indexes = set()
        self.expected_total_hint = None
        self.crawled_item_count = 0

    def start_requests(self):
        yield scrapy.Request(self.start_urls[0], callback=self.parse)

    def parse(self, response):
        yield self._graphql_request(
            query=self._build_total_query(),
            callback=self.parse_total,
        )

    def parse_total(self, response):
        payload = self._safe_json(response)
        total = (payload.get("data") or {}).get("total")
        if isinstance(total, int) and total > 0:
            self.expected_total_hint = total
            total_pages = min(self.max_pages, math.ceil(total / self.page_size))
        else:
            total_pages = 1

        for page in range(1, total_pages + 1):
            if page in self.seen_page_indexes:
                continue
            self.seen_page_indexes.add(page)
            yield self._graphql_request(
                query=self._build_products_query(page),
                callback=self.parse_products_page,
                cb_kwargs={"page": page},
            )

    def parse_products_page(self, response, page):
        payload = self._safe_json(response)
        products = (payload.get("data") or {}).get("products") or []
        if not products:
            return

        for product in products:
            if not isinstance(product, dict):
                continue
            general = product.get("general") or {}
            filterable = product.get("filterable") or {}
            url_path = general.get("url_path")
            if not url_path:
                continue

            if not str(url_path).endswith(".html"):
                url_path = f"{url_path}.html"

            url = urljoin("https://cellphones.com.vn/", url_path)
            if url in self.seen_product_urls:
                continue

            listing_price = filterable.get("special_price") or filterable.get("price")
            listing_name = general.get("name")
            listing_brand = general.get("manufacturer")

            stock_available = filterable.get("stock_available_id")
            listing_in_stock = True
            if isinstance(stock_available, list):
                listing_in_stock = any(str(x) in {"46", "56", "152", "4920"} for x in stock_available)
            elif stock_available is not None:
                listing_in_stock = str(stock_available) in {"46", "56", "152", "4920"}

            self.seen_product_urls.add(url)
            yield response.follow(
                url,
                callback=self.parse_detail,
                cb_kwargs={
                    "listing_name": listing_name,
                    "listing_price": listing_price,
                    "listing_in_stock": listing_in_stock,
                    "listing_brand": listing_brand,
                },
            )

    def parse_detail(
        self,
        response,
        listing_name=None,
        listing_price=None,
        listing_in_stock=True,
        listing_brand=None,
    ):
        ld_product = extract_json_ld_product(response)
        offers = ld_product.get("offers") if isinstance(ld_product, dict) else None
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if not isinstance(offers, dict):
            offers = {}

        name = first_non_empty(
            [
                ld_product.get("name") if isinstance(ld_product, dict) else None,
                response.css("h1::text").get(),
                listing_name,
                response.css("meta[property='og:title']::attr(content)").get(),
            ]
        )

        price = first_non_empty(
            [
                offers.get("price"),
                offers.get("lowPrice"),
                listing_price,
                response.css("meta[property='product:price:amount']::attr(content)").get(),
            ]
        )

        brand_node = ld_product.get("brand") if isinstance(ld_product, dict) else None
        brand = first_non_empty(
            [
                brand_node.get("name") if isinstance(brand_node, dict) else brand_node,
                listing_brand,
            ]
        )

        image_url = extract_image_url(
            first_non_empty(
                [
                    ld_product.get("image") if isinstance(ld_product, dict) else None,
                    response.css("meta[property='og:image']::attr(content)").get(),
                ]
            )
        )

        self.crawled_item_count += 1
        yield PhoneItem(
            source="cellphones",
            product_id=response.url.rstrip("/").split("/")[-1].replace(".html", ""),
            name=clean_space(name),
            brand=clean_space(brand),
            model=clean_space(name),
            variant=None,
            price=price,
            in_stock=bool(listing_in_stock),
            product_url=response.url,
            image_url=image_url,
            description=clean_space(
                response.css("meta[property='og:description']::attr(content)").get()
            ),
            category_path_raw=self.category,
        )

    def _graphql_request(self, query, callback, cb_kwargs=None):
        return scrapy.Request(
            url=self.graphql_endpoint,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Origin": "https://cellphones.com.vn",
                "Referer": self.start_urls[0],
            },
            body=json.dumps({"query": query, "variables": {}}),
            callback=callback,
            cb_kwargs=cb_kwargs or {},
            dont_filter=True,
        )

    def _build_total_query(self):
        return (
            "query GetTotal{"
            "total("
            f'filter:{{static:{{categories:["{self.category_id}"],province_id:{self.province_id},'
            "stock:{from:0}}}})"
            "}"
        )

    def _build_products_query(self, page):
        return (
            "query GetProducts{"
            "products("
            f'filter:{{static:{{categories:["{self.category_id}"],province_id:{self.province_id},'
            "stock:{from:0}}}}}"
            f",page:{page},size:{self.page_size},sort:[{{view:desc}}]"
            "){"
            "general{name url_path manufacturer}"
            "filterable{price special_price stock_available_id}"
            "}"
            "}"
        )

    @staticmethod
    def _safe_json(response):
        try:
            return json.loads(response.text)
        except Exception:
            return {}


class CellphoneSPhoneSpider(CellphoneSCatalogSpider):
    name = "cellphones_phone"
