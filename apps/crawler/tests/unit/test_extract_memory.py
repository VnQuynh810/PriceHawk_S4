"""
Unit tests cho hàm extract_memory() trong normalizer.py
Đây là hàm hay có edge case nhất: 5G mạng bị nhận nhầm là RAM,
cặp RAM/ROM bị parse sai thứ tự, 1TB bị bỏ qua...
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from price_hawk.normalizer import extract_memory


class TestExtractMemory:

    # ── Happy path ────────────────────────────────────────────────────────────

    def test_explicit_ram_keyword(self):
        """'RAM 8GB 256GB' → ram=8g, rom=256g"""
        ram, rom = extract_memory("xiaomi redmi note 14 ram 8gb 256gb")
        assert ram == "8g"
        assert rom == "256g"

    def test_separate_gb_tokens(self):
        """'16GB 512GB' → ram=16g, rom=512g"""
        ram, rom = extract_memory("laptop dell 16gb 512gb ssd")
        assert ram == "16g"
        assert rom == "512g"

    def test_1tb_storage(self):
        """1TB → rom='1t'"""
        ram, rom = extract_memory("macbook pro 32gb 1tb")
        assert rom == "1t"

    def test_512gb_only_is_rom(self):
        """Chỉ có 1 capacity → đó là ROM (storage)"""
        ram, rom = extract_memory("ipad 256gb")
        assert rom == "256g"
        assert ram is None

    # ── Edge cases — 5G/4G không phải bộ nhớ ─────────────────────────────────

    def test_5g_network_not_ram(self):
        """5G trong tên điện thoại là mạng di động, KHÔNG phải RAM/ROM"""
        ram, rom = extract_memory("samsung galaxy a55 5g 8gb 256gb")
        assert ram == "8g"
        assert rom == "256g"

    def test_4g_network_not_ram(self):
        """4G cũng không phải bộ nhớ"""
        ram, rom = extract_memory("oppo a78 4g 8gb 128gb")
        assert ram == "8g"
        assert rom == "128g"

    def test_pure_5g_phone_no_storage_mentioned(self):
        """Điện thoại 5G không nêu RAM/ROM → trả về (None, None)"""
        ram, rom = extract_memory("samsung 5g phone")
        assert ram is None
        assert rom is None

    # ── Empty / None inputs ───────────────────────────────────────────────────

    def test_empty_string(self):
        ram, rom = extract_memory("")
        assert ram is None
        assert rom is None

    def test_no_memory_info(self):
        """Tên không có thông tin bộ nhớ"""
        ram, rom = extract_memory("samsung galaxy a14")
        assert ram is None
        assert rom is None

    # ── Slash format variations ───────────────────────────────────────────────

    def test_slash_128gb(self):
        ram, rom = extract_memory("poco x6 pro 12/512")
        assert ram == "12g"
        assert rom == "512g"

    # ── Large storage ─────────────────────────────────────────────────────────

    def test_2tb_storage(self):
        ram, rom = extract_memory("macbook pro m4 max 48gb 2tb")
        assert rom == "2t"

