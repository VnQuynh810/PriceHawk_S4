"""
Unit tests cho price_hawk/normalizer.py

Đây là module critical nhất trong pipeline — sai ở đây
là toàn bộ data trong DB sẽ sai theo.
"""
import pytest
import sys
import os

# Thêm thư mục gốc price-hawk vào Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from price_hawk.normalizer import (
    normalize_phone_identity,
    normalize_laptop_identity,
    normalize_tablet_identity,
    normalize_identity_by_category,
)


# ══════════════════════════════════════════════════════════════════════════════
# normalize_phone_identity()
# ══════════════════════════════════════════════════════════════════════════════
class TestNormalizePhoneIdentity:

    def test_samsung_galaxy_s25_ultra(self):
        result = normalize_phone_identity(
            "Điện thoại Samsung Galaxy S25 Ultra 12GB/256GB Đen",
            brand="Samsung"
        )
        assert result["brand_norm"] == "samsung"
        assert result["ram_norm"] == "12g"
        assert result["rom_norm"] == "256g"
        assert result["color_norm"] == "black"
        assert "ram-12g" in result["variant_key"]
        assert "rom-256g" in result["variant_key"]
        assert "color-black" in result["variant_key"]

    def test_iphone_16_pro_max_titanium(self):
        result = normalize_phone_identity(
            "iPhone 16 Pro Max 256GB Titanium",
            brand="Apple"
        )
        assert result["brand_norm"] == "apple"
        assert result["rom_norm"] == "256g"
        assert result["color_norm"] == "titanium"

    def test_xiaomi_redmi_infer_brand_from_name(self):
        """Khi brand không truyền vào, infer từ tên sản phẩm"""
        result = normalize_phone_identity(
            "Redmi Note 14 Pro 8GB/256GB",
            brand=None
        )
        assert result["brand_norm"] == "xiaomi"
        assert result["ram_norm"] == "8g"
        assert result["rom_norm"] == "256g"

    def test_confidence_score_has_all_fields(self):
        """Product đầy đủ brand + model + ram + rom + color → confidence cao"""
        result = normalize_phone_identity(
            "Samsung Galaxy A55 8GB 256GB Blue",
            brand="Samsung"
        )
        assert result["confidence_score"] >= 0.85

    def test_model_key_is_slugified(self):
        """model_key phải là slug hợp lệ (chỉ a-z0-9 và dấu gạch ngang)"""
        result = normalize_phone_identity("iPhone 16 Pro 128GB", brand="Apple")
        model_key = result["model_key"]
        assert model_key is not None
        import re
        assert re.match(r'^[a-z0-9\-]+$', model_key), f"Invalid slug: {model_key}"

    def test_empty_name_returns_valid_dict(self):
        """Không crash khi name rỗng"""
        result = normalize_phone_identity("", brand=None)
        assert isinstance(result, dict)
        assert "brand_norm" in result
        assert "variant_key" in result

    def test_none_name_returns_valid_dict(self):
        """Không crash khi name là None"""
        result = normalize_phone_identity(None, brand=None)
        assert isinstance(result, dict)

    def test_5g_network_not_mistaken_as_ram(self):
        """5G trong tên điện thoại là mạng, không phải RAM"""
        result = normalize_phone_identity(
            "Samsung Galaxy A35 5G 8GB 256GB",
            brand="Samsung"
        )
        assert result["ram_norm"] == "8g"
        assert result["rom_norm"] == "256g"

    def test_variant_key_format(self):
        """variant_key luôn có đúng format ram-X_rom-X_color-X"""
        result = normalize_phone_identity("Oppo Reno 12F 8GB/256GB", brand="Oppo")
        variant = result["variant_key"]
        assert variant.startswith("ram-")
        assert "_rom-" in variant
        assert "_color-" in variant


# ══════════════════════════════════════════════════════════════════════════════
# normalize_laptop_identity()
# ══════════════════════════════════════════════════════════════════════════════
class TestNormalizeLaptopIdentity:

    def test_dell_inspiron_full(self):
        result = normalize_laptop_identity(
            "Laptop Dell Inspiron 15 3520 i5-1235U 16GB 512GB SSD",
            brand="Dell"
        )
        assert result["brand_norm"] == "dell"
        assert result["ram_norm"] == "16g"
        assert result["rom_norm"] == "512g"
        # Laptop không có color
        assert result["color_norm"] is None

    def test_laptop_variant_key_no_color(self):
        """Laptop variant_key chỉ có ram và rom, không có color"""
        result = normalize_laptop_identity(
            "Asus VivoBook 15 i5 16GB 512GB",
            brand="Asus"
        )
        variant = result["variant_key"]
        assert "ram-" in variant
        assert "_rom-" in variant
        # Laptop không có color field
        assert "color-" not in variant

    def test_infer_brand_asus_vivobook(self):
        """Infer brand từ 'VivoBook' → asus"""
        result = normalize_laptop_identity(
            "VivoBook 15 X1502ZA i7 16GB 512GB",
            brand=None
        )
        assert result["brand_norm"] == "asus"

    def test_macbook_brand_is_apple(self):
        result = normalize_laptop_identity(
            "MacBook Air M2 8GB 256GB",
            brand=None
        )
        assert result["brand_norm"] == "apple"

    def test_laptop_noise_words_removed(self):
        """Từ 'laptop', 'gaming' phải được xóa khỏi model_key"""
        result = normalize_laptop_identity(
            "Laptop Gaming MSI Katana GF66 16GB 512GB",
            brand="MSI"
        )
        model_key = result.get("model_key", "")
        if model_key:
            assert "laptop" not in model_key
            assert "gaming" not in model_key

    def test_1tb_rom(self):
        """1TB phải được parse thành '1t'"""
        result = normalize_laptop_identity(
            "Dell XPS 15 32GB 1TB SSD",
            brand="Dell"
        )
        assert result["rom_norm"] == "1t"


# ══════════════════════════════════════════════════════════════════════════════
# normalize_tablet_identity()
# ══════════════════════════════════════════════════════════════════════════════
class TestNormalizeTabletIdentity:

    def test_ipad_air_m2(self):
        result = normalize_tablet_identity(
            "iPad Air M2 8GB 128GB WiFi Blue",
            brand="Apple"
        )
        assert result["brand_norm"] == "apple"
        assert result["color_norm"] == "blue"
        assert result["rom_norm"] == "128g"

    def test_samsung_galaxy_tab(self):
        result = normalize_tablet_identity(
            "Samsung Galaxy Tab S9 FE 8GB 256GB Silver",
            brand="Samsung"
        )
        assert result["brand_norm"] == "samsung"
        assert result["color_norm"] == "silver"

    def test_tablet_has_color_in_variant(self):
        """Tablet (khác laptop) phải có color trong variant_key"""
        result = normalize_tablet_identity(
            "iPad Pro M4 16GB 256GB Space Black",
            brand="Apple"
        )
        assert "color-" in result["variant_key"]


# ══════════════════════════════════════════════════════════════════════════════
# normalize_identity_by_category() — dispatcher
# ══════════════════════════════════════════════════════════════════════════════
class TestNormalizeIdentityByCategory:

    def test_dispatch_laptop_category(self):
        result = normalize_identity_by_category(
            "Dell XPS 15 16GB 512GB",
            brand="Dell",
            category="laptop"
        )
        # Laptop không có color
        assert result["color_norm"] is None

    def test_dispatch_tablet_category(self):
        result = normalize_identity_by_category(
            "iPad Air 8GB 128GB Pink",
            brand="Apple",
            category="tablet"
        )
        assert result["color_norm"] == "pink"

    def test_dispatch_phone_as_default(self):
        """Khi category không phải laptop/tablet → mặc định là phone"""
        result = normalize_identity_by_category(
            "Samsung Galaxy S24 8GB 256GB",
            brand="Samsung",
            category=None
        )
        assert result["brand_norm"] == "samsung"
