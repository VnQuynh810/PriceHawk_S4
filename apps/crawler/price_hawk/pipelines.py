import re
from datetime import datetime, timezone
from itemadapter import ItemAdapter
from price_hawk.normalizer import (
    canonicalize_url,
    is_laptop_category,
    is_tablet_category,
    normalize_identity_by_category,
    to_ascii_lower,
)


def infer_canonical_category(category_raw: str | None) -> str:
    lowered = to_ascii_lower(category_raw or "")
    if is_laptop_category(lowered):
        return "laptop"
    if is_tablet_category(lowered):
        return "tablet"
    return "dien-thoai"


class NormalizePhonePipeline:
    def process_item(self, item, spider=None):
        adapter = ItemAdapter(item)
        adapter["source"] = (adapter.get("source") or "").strip().lower()
        adapter["name"] = clean_text(adapter.get("name"))
        adapter["brand"] = clean_text(adapter.get("brand"))
        adapter["model"] = clean_text(adapter.get("model"))
        adapter["variant"] = clean_text(adapter.get("variant"))
        adapter["currency"] = "VND"
        adapter["price"] = parse_price(adapter.get("price"))

        if adapter.get("in_stock") is None:
            adapter["in_stock"] = True

        adapter["product_url"] = canonicalize_url(clean_text(adapter.get("product_url")))
        adapter["image_url"] = clean_text(adapter.get("image_url"))
        adapter["description"] = clean_text(adapter.get("description"))
        raw_cat = clean_text(adapter.get("category_path_raw"))
        adapter["category"] = infer_canonical_category(raw_cat)

        identity_text = " ".join(
            [
                adapter.get("name") or "",
                adapter.get("variant") or "",
            ]
        ).strip()
        norm = normalize_identity_by_category(
            identity_text,
            adapter.get("brand"),
            raw_cat,
        )
        adapter["brand_norm"] = clean_text(norm.get("brand_norm"))
        adapter["model_key"] = clean_text(norm.get("model_key"))
        adapter["variant_key"] = clean_text(norm.get("variant_key")) or "na"
        adapter["identity_key"] = clean_text(norm.get("identity_key"))
        if adapter.get("model_key"):
            adapter["normalize_name"] = f"{adapter.get('model_key')}__{adapter.get('variant_key')}"
        else:
            adapter["normalize_name"] = adapter["identity_key"]

        if not adapter.get("brand") and adapter.get("brand_norm"):
            adapter["brand"] = adapter.get("brand_norm")

        variant_key = adapter.get("variant_key") or ""
        ram_match = re.search(r"ram-(\w+?)(?:_|$)", variant_key)
        rom_match = re.search(r"rom-(\w+?)(?:_|$)", variant_key)

        if ram_match and ram_match.group(1).lower() != "na":
            adapter["ram"] = ram_match.group(1)
        elif not adapter.get("ram"):
            adapter["ram"] = norm.get("ram_norm")

        if rom_match and rom_match.group(1).lower() != "na":
            adapter["rom"] = rom_match.group(1)
        elif not adapter.get("rom"):
            adapter["rom"] = norm.get("rom_norm")

        if not adapter.get("scraped_at"):
            adapter["scraped_at"] = datetime.now(timezone.utc).isoformat()

        allowed_fields = {
            "source",
            "product_url",
            "name",
            "brand_norm",
            "model_key",
            "variant_key",
            "identity_key",
            "normalize_name",
            "category",
            "price",
            "in_stock",
            "scraped_at",
            "image_url",
            "description",
            "ram",
            "rom",
        }
        for key in list(adapter.keys()):
            if key not in allowed_fields:
                del adapter[key]

        return item


def clean_text(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def parse_price(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(value))

    digits = re.sub(r"[^0-9]", "", str(value))
    if not digits:
        return None

    try:
        return int(digits)
    except ValueError:
        return None


class BatchDBPipeline:
    """True bulk DB pipeline with cross-spider MIN(price) sync and alert evaluation."""

    def __init__(self):
        from price_hawk.db_batch_processor import BatchDBProcessor
        self.db_processor = BatchDBProcessor(batch_size=200)

    def process_item(self, item, spider=None):
        try:
            self.db_processor.add_item(dict(item))
        except Exception as e:
            if spider:
                spider.logger.error(f"DB buffer/insert failed: {e}")
        return item

    def close_spider(self, spider):
        if spider:
            spider.logger.info("Flushing remaining DB items & evaluating price alerts...")
            # Persist AI-healed selectors & incremental <lastmod> URL states if present
            healed = getattr(spider, "healed_selectors", None)
            source_code = getattr(spider, "source_code", None)
            if healed and source_code:
                self.db_processor.save_healed_selectors(source_code, healed)

            url_states = getattr(spider, "updated_url_states", None)
            if url_states:
                self.db_processor.save_url_states(url_states)

        self.db_processor.close()
