"""
internet_agent.py — Lightweight Async Internet Fallback (SearXNG + httpx + BeautifulSoup).
Replaces Playwright/Chromium (crawl4ai) to cut RAM usage from >450MB down to ~20MB
and eliminate Linux OOM-kills inside 256MB containers.
Also returns raw clean context directly to ResponderAgent (saving 1 redundant LLM call).
"""

import asyncio
import os
import re
from bs4 import BeautifulSoup
from dotenv import load_dotenv
import httpx

load_dotenv()

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class InternetAgent:
    async def run(self, keyword: str) -> dict:
        if not keyword:
            return self._not_found(keyword)

        search_results = await self._web_search(keyword)
        if not search_results:
            return self._not_found(keyword)

        best = self._pick_best_result(search_results)
        best_url = best.get("url", "")
        snippets = "\n".join(
            f"- {r.get('title', '')}: {r.get('content', '')} ({r.get('url', '')})"
            for r in search_results[:5]
            if r.get("content") or r.get("title")
        )

        page_text = await self._fetch_clean_text(best_url) if best_url else None
        combined_context = ""
        if snippets:
            combined_context += f"Tóm tắt kết quả tìm kiếm:\n{snippets}\n\n"
        if page_text:
            combined_context += f"Nội dung chi tiết trang ({best_url}):\n{page_text}"

        combined_context = combined_context.strip()
        if not combined_context:
            return self._not_found(keyword)

        return {
            "found": True,
            "summary": combined_context[:5000],
            "source_url": best_url,
            "keyword": keyword,
        }

    async def _web_search(self, keyword: str) -> list[dict]:
        query = f"{keyword} giá thông số đánh giá Việt Nam"
        searxng_url = os.getenv("SEARXNG_URL", "http://searxng:8080")

        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=8.0) as http_client:
                    response = await http_client.get(
                        f"{searxng_url}/search",
                        params={"q": query, "format": "json"},
                    )
                    response.raise_for_status()
                    results = response.json().get("results", [])
                    if results:
                        return results[:6]
            except Exception as e:
                print(f"[InternetAgent] SearXNG attempt {attempt + 1}/2 error: {e}")
            await asyncio.sleep(1.0)
        return []

    def _pick_best_result(self, results: list[dict]) -> dict:
        priority_domains = (
            "thegioididong.com",
            "fptshop.com.vn",
            "hoanghamobile.com",
            "cellphones.com.vn",
            "tinhte.vn",
            "genk.vn",
            "websosanh.vn",
        )
        for domain in priority_domains:
            for r in results:
                if domain in r.get("url", ""):
                    return r
        return results[0]

    async def _fetch_clean_text(self, url: str) -> str | None:
        try:
            async with httpx.AsyncClient(
                timeout=8.0,
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT, "Accept-Language": "vi-VN,vi;q=0.9"},
            ) as http_client:
                res = await http_client.get(url)
                if res.status_code >= 400 or "text/html" not in res.headers.get("content-type", ""):
                    return None

                soup = BeautifulSoup(res.text, "html.parser")
                for tag in soup(["script", "style", "noscript", "svg", "footer", "nav", "header", "aside"]):
                    tag.decompose()

                root = soup.find("main") or soup.find("article") or soup.body or soup
                text = root.get_text(separator=" ", strip=True)
                text = re.sub(r"\s+", " ", text).strip()
                return text[:4000] if len(text) >= 80 else None
        except Exception as e:
            print(f"[InternetAgent] Fetch text warning ({url}): {e}")
            return None

    def _not_found(self, keyword: str) -> dict:
        return {"found": False, "summary": None, "source_url": None, "keyword": keyword}
