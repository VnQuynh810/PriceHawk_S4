"""
intent_agent.py — Non-blocking AsyncGroq Intent & Entity Extractor.
"""

import asyncio
import json
import os
import re
from dotenv import load_dotenv
from groq import AsyncGroq

load_dotenv()

groq_api_key = os.getenv("GROQ_API_KEY")
client = AsyncGroq(api_key=groq_api_key) if groq_api_key else None
MODEL_PRIMARY = "llama-3.3-70b-versatile"
MODEL_FALLBACK = "llama-3.1-8b-instant"

INTENT_PRICE_QUERY = "price_query"
INTENT_COMPARE = "compare"
INTENT_REVIEW_QUERY = "review_query"
INTENT_IRRELEVANT = "irrelevant"
INTENT_OUT_OF_SCOPE = "out_of_scope"

SYSTEM_PROMPT = """Bạn là assistant phân tích câu hỏi trên website so sánh giá điện thoại, laptop và tablet tại Việt Nam.

Nhiệm vụ: Phân tích câu hỏi và trả về JSON với các trường:
- "intent": "price_query" | "compare" | "review_query" | "out_of_scope" | "irrelevant"
- "product_name": tên 1 sản phẩm ngắn gọn, chỉ giữ tên thương hiệu + model (VD: "HONOR Pad X7", "iPhone 15 Pro Max"). Nếu là "compare", đây là sản phẩm thứ nhất. Hoặc null.
- "product_name_2": tên sản phẩm thứ 2 nếu intent là "compare". Hoặc null.
- "brand": thương hiệu nếu nhận ra (string hoặc null)
- "category": "dien-thoai" | "laptop" | "tablet" | null

QUAN TRỌNG: product_name chỉ gồm tên thương hiệu + model, KHÔNG bao gồm các từ hỏi như "giá bao nhiêu", "có tốt không", "review", v.v.
Trả về JSON thuần túy, không có markdown."""


def _extract_json(text: str) -> dict:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}


def _fallback_extract(user_message: str) -> str:
    noise = [
        r"giá bao nhiêu\??", r"bao nhiêu tiền\??", r"có bao nhiêu\??",
        r"review", r"đánh giá", r"thông số", r"so sánh",
        r"nên mua không\??", r"có tốt không\??", r"mua ở đâu",
        r"rẻ nhất", r"tốt nhất", r"giá", r"mua",
    ]
    cleaned = user_message
    for pattern in noise:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip(" ?,.!") or user_message


class IntentAgent:
    async def run(self, user_message: str, history: list | None = None) -> dict:
        history = history or []
        context_lines = []
        for turn in history[-2:]:
            role = "Người dùng" if turn["role"] == "user" else "Trợ lý"
            context_lines.append(f"{role}: {turn['content'][:200]}")

        user_content = f'Câu hỏi: "{user_message}"'
        if context_lines:
            user_content = "Lịch sử:\n" + "\n".join(context_lines) + f"\n\n{user_content}"

        models_to_try = [MODEL_PRIMARY, MODEL_FALLBACK] if client else []

        for attempt, model_name in enumerate(models_to_try):
            try:
                response = await client.chat.completions.create(
                    model=model_name,
                    temperature=0,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                )
                result = _extract_json(response.choices[0].message.content or "")

                intent = result.get("intent", "price_query")
                if intent not in ("price_query", "compare", "review_query", "out_of_scope", "irrelevant"):
                    intent = "price_query"

                return {
                    "intent": intent,
                    "product_name": result.get("product_name"),
                    "product_name_2": result.get("product_name_2"),
                    "brand": result.get("brand"),
                    "category": result.get("category"),
                }
            except Exception as e:
                if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)) and attempt < len(models_to_try) - 1:
                    await asyncio.sleep(1.5)
                    continue
                print(f"[IntentAgent] Error ({model_name}): {e}")
                break

        return {
            "intent": "price_query",
            "product_name": _fallback_extract(user_message),
            "product_name_2": None,
            "brand": None,
            "category": None,
        }
