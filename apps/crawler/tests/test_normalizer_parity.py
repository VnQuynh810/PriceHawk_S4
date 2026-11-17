import json
from pathlib import Path
import pytest
from price_hawk.normalizer import canonicalize_url, normalize_identity_by_category

FIXTURES_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "shared-fixtures"
    / "normalizer_cases.json"
)

CASES = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["description"] for c in CASES])
def test_python_normalizer_matches_shared_golden_fixtures(case):
    inp = case["input"]
    exp = case["expected"]

    actual = normalize_identity_by_category(inp["name"], inp["brand"], inp["category"])
    assert actual["brand_norm"] == exp["brandNorm"]
    assert actual["model_key"] == exp["modelKey"]
    assert actual["variant_key"] == exp["variantKey"]
    assert actual["identity_key"] == exp["identityKey"]
    assert actual["ram_norm"] == exp["ramNorm"]
    assert actual["rom_norm"] == exp["romNorm"]
    assert actual["color_norm"] == exp["colorNorm"]


def test_canonicalize_url_strips_utm_and_fbclid():
    dirty = "https://www.thegioididong.com/may-tinh-bang/honor-pad-x7-wifi-4gb-64gb/?utm_flashsale=1&fbclid=xyz"
    assert (
        canonicalize_url(dirty)
        == "https://www.thegioididong.com/may-tinh-bang/honor-pad-x7-wifi-4gb-64gb"
    )
