import json
from unittest.mock import MagicMock, patch

from price_hawk.extractors.ai_selector_healer import AISelectorHealer
from price_hawk.pool_manager import (
    AutonomousPoolManager,
    infer_source_code_from_url,
    keyword_matches_title,
)


def test_keyword_matches_title_relevance_filter():
    assert keyword_matches_title(
        "iPhone 16 Pro Max 256GB",
        "Điện thoại Apple iPhone 16 Pro Max 256GB Chính hãng VN/A",
    ) is True
    assert keyword_matches_title(
        "iPhone 16 Pro Max 256GB",
        "Ốp lưng nhựa dẻo cơ bản giá rẻ",
    ) is False


def test_infer_source_code_from_url():
    assert infer_source_code_from_url("https://www.thegioididong.com/dtdd/iphone-16") == "tgdd"
    assert infer_source_code_from_url("https://phongvu.vn/macbook-air-m3") == "phongvu"
    assert infer_source_code_from_url("https://didongviet.vn/iphone-16.html") == "didongviet"


def test_ollama_gemma4_self_hosted_healer_support():
    html = """
    <html><body>
      <h1 class="gemma-title">MacBook Pro 14 M4 16GB 512GB</h1>
      <span class="gemma-price">39.990.000đ</span>
    </body></html>
    """
    # Notice: no API key passed — local Ollama URL should auto-enable without secret key!
    healer = AISelectorHealer(
        api_key=None,
        base_url="http://ollama:11434/v1/chat/completions",
        model="gemma4:e4b",
    )
    assert healer.can_attempt("localshop.vn") is True
    assert healer.model == "gemma4:e4b"

    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    # Simulate local Gemma 4 wrapping JSON inside markdown fences
    mock_resp.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '```json\n{"name_css": "h1.gemma-title", "price_css": "span.gemma-price"}\n```'
                }
            }
        ]
    }

    with patch("price_hawk.extractors.ai_selector_healer.requests.post", return_value=mock_resp) as post_mock:
        selectors = healer.discover_selectors("localshop.vn", html)
        assert selectors == {"name_css": "h1.gemma-title", "price_css": "span.gemma-price"}
        called_payload = post_mock.call_args.kwargs["json"]
        assert called_payload["model"] == "gemma4:e4b"


def test_searxng_domain_diverse_candidate_discovery():
    mgr = AutonomousPoolManager(searxng_url="http://searxng:8080")
    fake_searx_results = {
        "results": [
            {"url": "https://www.thegioididong.com/dtdd/iphone-16?utm_source=ads"},
            {"url": "https://www.thegioididong.com/tin-tuc/danh-gia-iphone-16"},  # blog -> filtered!
            {"url": "https://fptshop.com.vn/dien-thoai/iphone-16"},
            {"url": "https://phongvu.vn/iphone-16-128gb"},
            {"url": "https://untrusted-random-blog.org/iphone-16"},  # untrusted -> filtered!
        ]
    }
    mock_resp = MagicMock()
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = fake_searx_results

    with patch("price_hawk.pool_manager.requests.get", return_value=mock_resp):
        urls = mgr.search_candidate_urls_via_searxng(
            "iPhone 16 128GB",
            ["thegioididong.com", "fptshop.com.vn", "phongvu.vn"],
            max_urls=5,
        )
        assert urls == [
            "https://www.thegioididong.com/dtdd/iphone-16",
            "https://fptshop.com.vn/dien-thoai/iphone-16",
            "https://phongvu.vn/iphone-16-128gb",
        ]


def test_process_discovery_queue_ingests_multi_store_offers():
    mgr = AutonomousPoolManager(searxng_url="http://searxng:8080")

    pending_seed = [
        {
            "id": 101,
            "seed_type": "keyword",
            "query_or_url": "iPhone 16 128GB",
            "category_hint": "dien-thoai",
        }
    ]

    mock_cur = MagicMock()
    # 1st conn: SHOW TABLES -> yes, SELECT pending -> pending_seed
    mock_cur.fetchone.side_effect = [{"t": "discovery_queue"}, None]
    mock_cur.fetchall.side_effect = [pending_seed, []]

    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_writer = MagicMock()

    searx_json = {
        "results": [
            {"url": "https://fptshop.com.vn/dien-thoai/iphone-16-128gb"},
            {"url": "https://cellphones.com.vn/iphone-16-128gb.html"},
        ]
    }
    product_html = """
    <html><head>
      <script type="application/ld+json">
        {"@type":"Product","name":"iPhone 16 128GB Đen","brand":{"name":"Apple"},"offers":{"price":"21990000"}}
      </script>
    </head></html>
    """

    def _fake_requests_get(url, **kwargs):
        r = MagicMock()
        r.status_code = 200
        r.raise_for_status.return_value = None
        if "searxng" in url:
            r.json.return_value = searx_json
        else:
            r.url = url
            r.text = product_html
        return r

    with (
        patch.object(mgr, "_get_conn", return_value=mock_conn),
        patch.object(mgr, "get_trusted_domains", return_value=["fptshop.com.vn", "cellphones.com.vn"]),
        patch("price_hawk.pool_manager.BatchDBProcessor", return_value=mock_writer),
        patch("price_hawk.pool_manager.requests.get", side_effect=_fake_requests_get),
    ):
        ingested = mgr.process_discovery_queue(batch_limit=5)
        assert ingested == 2
        assert mock_writer.add_item.call_count == 2
        mock_writer.close.assert_called_once()
