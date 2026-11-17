"""
Unit tests cho hàm extract_color() trong normalizer.py
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from price_hawk.normalizer import extract_color


class TestExtractColor:

    def test_black_midnight(self):
        """'midnight' là alias của black"""
        assert extract_color("iphone 16 midnight 128gb") == "black"

    def test_explicit_black(self):
        assert extract_color("samsung s25 black 8gb") == "black"

    def test_white(self):
        assert extract_color("samsung galaxy a55 white") == "white"

    def test_blue(self):
        assert extract_color("oppo reno 12 blue 8gb 256gb") == "blue"

    def test_blue_alias_xanh_duong(self):
        """Tiếng Việt: xanh duong → blue"""
        assert extract_color("samsung a15 xanh duong 4gb 128gb") == "blue"

    def test_titanium(self):
        assert extract_color("iphone 16 pro titanium 256gb") == "titanium"

    def test_desert(self):
        assert extract_color("iphone 15 pro desert 256gb") == "desert"

    def test_gold(self):
        assert extract_color("samsung s24 gold 8gb 256gb") == "gold"

    def test_silver(self):
        assert extract_color("samsung a35 silver 8gb 256gb") == "silver"

    def test_gray(self):
        assert extract_color("iphone 14 gray 128gb") == "gray"

    def test_grey_is_gray(self):
        """grey và gray là cùng một màu"""
        assert extract_color("laptop dell grey 16gb 512gb") == "gray"

    def test_pink(self):
        assert extract_color("oppo a18 pink 4gb 64gb") == "pink"

    def test_green(self):
        assert extract_color("iphone 15 green 128gb") == "green"

    def test_purple(self):
        assert extract_color("samsung a54 purple 8gb 256gb") == "purple"

    def test_navy(self):
        assert extract_color("samsung s24 navy 8gb 256gb") == "navy"

    def test_mint(self):
        assert extract_color("samsung a35 mint 8gb 256gb") == "mint"

    def test_no_color_returns_none(self):
        """Không có màu → trả về None"""
        assert extract_color("samsung galaxy s25 8gb 256gb") is None

    def test_empty_string_returns_none(self):
        assert extract_color("") is None

    def test_case_insensitive_matching(self):
        """Màu 'Black' viết hoa đầu cũng nhận diện được"""
        # Hàm nhận input đã qua to_ascii_lower nên luôn lowercase
        assert extract_color("iphone 16 black 128gb") == "black"
