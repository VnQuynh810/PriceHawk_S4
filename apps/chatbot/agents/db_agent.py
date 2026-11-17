"""
db_agent.py — Non-blocking Async DB Search Agent.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import db as database


CATEGORY_HINTS = {
    "dien-thoai": [
        "điện thoại", "phone", "iphone", "samsung", "xiaomi", "oppo",
        "vivo", "realme", "honor", "nokia", "redmi", "galaxy s", "galaxy a",
    ],
    "laptop": [
        "laptop", "máy tính xách tay", "macbook", "notebook", "dell", "hp",
        "asus", "acer", "lenovo", "msi", "surface", "thinkpad",
    ],
    "tablet": ["tablet", "máy tính bảng", "ipad", "galaxy tab"],
}


def detect_category_from_query(product_name: str, explicit_category: str | None) -> str | None:
    if explicit_category:
        return explicit_category
    if not product_name:
        return None
    name_lower = product_name.lower()
    for category, keywords in CATEGORY_HINTS.items():
        for kw in keywords:
            if kw in name_lower:
                return category
    return None


class DBAgent:
    async def run(self, product_name: str | None, category: str | None = None) -> dict:
        if not product_name:
            return self._not_found(keyword="", db_available=True)

        detected_category = detect_category_from_query(product_name, category)
        rows, match_type = await database.search_products_async(
            product_name, category=detected_category, limit=10
        )

        if not rows:
            return self._not_found(keyword=product_name, db_available=True)

        grouped = database.group_by_product(rows)
        return {
            "found": True,
            "products": grouped,
            "search_keyword": product_name,
            "match_type": match_type,
            "db_available": True,
        }

    def _not_found(self, keyword: str, db_available: bool) -> dict:
        return {
            "found": False,
            "products": [],
            "search_keyword": keyword,
            "match_type": None,
            "db_available": db_available,
        }
