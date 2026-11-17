"""
ai_selector_healer.py — Self-Healing CSS Selector Discovery (Groq Cloud OR Ollama Gemma 4).

Supports any OpenAI-compatible Chat Completions endpoint via env vars:
  - Cloud Default (0MB RAM on VPS):
      AI_HEALER_BASE_URL=https://api.groq.com/openai/v1/chat/completions
      AI_HEALER_MODEL=llama-3.1-8b-instant
      AI_HEALER_API_KEY=<GROQ_API_KEY>
  - Self-Hosted Ollama Gemma 4 (on >= 6-8GB RAM / GPU worker):
      AI_HEALER_BASE_URL=http://ollama:11434/v1/chat/completions
      AI_HEALER_MODEL=gemma4:e4b   (or gemma4:e2b)
      AI_HEALER_API_KEY=ollama
"""

import json
import os
import re
from typing import Dict, Optional, Set
import requests
from .universal_extractor import UniversalExtractor

DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"


def _minify_html_for_llm(html: str, max_chars: int = 7000) -> str:
    cleaned = re.sub(
        r"<(script|style|svg|noscript|footer|nav|header|iframe)\b[^>]*>.*?</\1>",
        "",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL)

    def _trim_attrs(match):
        tag = match.group(1)
        attrs = match.group(2) or ""
        kept = re.findall(
            r'\b(?:id|class|itemprop)=["\'][^"\']{1,80}["\']',
            attrs,
            flags=re.IGNORECASE,
        )
        return f"<{tag}" + (" " + " ".join(kept) if kept else "") + ">"

    cleaned = re.sub(r"<([a-zA-Z0-9]+)(\s+[^>]+)?>", _trim_attrs, cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_chars]


class AISelectorHealer:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.base_url = (
            base_url or os.getenv("AI_HEALER_BASE_URL") or DEFAULT_GROQ_URL
        ).strip()
        self.model = (
            model or os.getenv("AI_HEALER_MODEL") or DEFAULT_GROQ_MODEL
        ).strip()
        # Local Ollama endpoints don't require a real secret key
        is_local_ollama = "11434" in self.base_url or "ollama" in self.base_url.lower()
        self.api_key = (
            api_key
            or os.getenv("AI_HEALER_API_KEY")
            or os.getenv("GROQ_API_KEY")
            or ("ollama" if is_local_ollama else None)
        )
        self._attempted_domains: Set[str] = set()

    def can_attempt(self, domain: str) -> bool:
        return bool(self.api_key) and domain not in self._attempted_domains

    def discover_selectors(self, domain: str, html: str, url: str = "") -> Optional[Dict[str, str]]:
        if not self.can_attempt(domain):
            return None

        self._attempted_domains.add(domain)
        snippet = _minify_html_for_llm(html)
        if len(snippet) < 100:
            return None

        prompt = (
            "You are an expert web scraping engineer. Given the minified Vietnamese e-commerce product HTML below, "
            "return ONLY valid JSON with CSS selectors for the main product title and selling price:\n"
            '{"name_css": "...", "price_css": "...", "image_css": "..."}\n\n'
            f"HTML:\n{snippet}"
        )

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            resp = requests.post(
                self.base_url,
                headers=headers,
                json={
                    "model": self.model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=25,
            )
            resp.raise_for_status()
            raw_content = resp.json()["choices"][0]["message"]["content"]
            # Strip markdown code fences if a local model wraps JSON
            json_match = re.search(r"\{.*\}", raw_content, re.DOTALL)
            proposed = json.loads(json_match.group(0) if json_match else raw_content)
            if not isinstance(proposed, dict):
                return None

            candidate = {
                k: str(v).strip()
                for k, v in proposed.items()
                if k in ("name_css", "price_css", "image_css", "brand_css")
                and isinstance(v, str)
                and v.strip()
            }
            if not (candidate.get("name_css") and candidate.get("price_css")):
                return None

            verified = UniversalExtractor.extract(html, url=url, custom_selectors=candidate)
            if verified.get("name") and verified.get("price"):
                return candidate
            return None
        except Exception as e:
            print(f"[AISelectorHealer] Failed for {domain} ({self.model}): {e}")
            return None
