import pytest
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))

from price_hawk.pipelines import NormalizePhonePipeline


class TestNormalizePhonePipeline:
    def setup_method(self):
        self.pipeline = NormalizePhonePipeline()

    def test_process_item_basic_phone(self):
        raw_item = {
            "source": "TGDD",
            "name": "Điện thoại Samsung Galaxy S24 Ultra 5G 12GB/256GB",
            "brand": "Samsung",
            "price": "31.990.000₫",
            "product_url": "https://example.com/s24",
            "image_url": "https://example.com/img.jpg",
            "category_path_raw": "dien-thoai",
        }

        # Chạy pipeline
        processed = self.pipeline.process_item(raw_item)

        assert processed["source"] == "tgdd"
        assert processed["brand_norm"] == "samsung"
        assert processed["model_key"] == "samsung-galaxy-s24-ultra-5g"
        # variant_key luôn có ram, rom, color. 
        # color mặc định nếu ko có là na
        assert "ram-12g_rom-256g" in processed["variant_key"]
        
        # Kiểm tra normalize_name theo logic mới (model_key__variant_key)
        assert processed["normalize_name"] == f"{processed['model_key']}__{processed['variant_key']}"
        
        # Kiểm tra extraction RAM/ROM
        assert processed["ram"] == "12g"
        assert processed["rom"] == "256g"
        
        # Kiểm tra parse_price
        assert processed["price"] == 31990000

        # Kiểm tra các trường mặc định
        assert processed["in_stock"] is True
        assert "scraped_at" in processed

        # Kiểm tra các trường bị xóa (chỉ giữ allowed_fields)
        assert "currency" not in processed
        assert "category_path_raw" not in processed

    def test_process_item_laptop(self):
        raw_item = {
            "source": "FPT",
            "name": "Laptop Dell Inspiron 15 3520 i5 1235U/8GB/512GB/Win11",
            "brand": "Dell",
            "price": 14500000,
            "product_url": "https://example.com/dell",
            "category_path_raw": "laptop",
        }

        processed = self.pipeline.process_item(raw_item)

        assert processed["source"] == "fpt"
        assert processed["brand_norm"] == "dell"
        assert "laptop" not in processed["model_key"]
        assert "ram-8g_rom-512g" in processed["variant_key"]
        assert processed["ram"] == "8g"
        assert processed["rom"] == "512g"
        assert processed["price"] == 14500000
