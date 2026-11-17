"""
pipeline.py — Async Agentic-RAG Orchestrator with TTL Query Caching.
"""

import time
from cachetools import TTLCache
from agents.intent_agent import (
    IntentAgent,
    INTENT_IRRELEVANT,
    INTENT_COMPARE,
    INTENT_OUT_OF_SCOPE,
)
from agents.db_agent import DBAgent
from agents.internet_agent import InternetAgent
from agents.responder_agent import ResponderAgent


class ChatbotPipeline:
    def __init__(self):
        self.intent_agent = IntentAgent()
        self.db_agent = DBAgent()
        self.internet_agent = InternetAgent()
        self.responder = ResponderAgent()
        # Cache identical standalone queries for 5 minutes (saves LLM quota & DB load)
        self._cache = TTLCache(maxsize=256, ttl=300)

    async def run(self, user_message: str, history: list | None = None) -> dict:
        start_time = time.time()
        history = history or []

        cache_key = None
        if not history:
            cache_key = user_message.strip().lower()
            cached = self._cache.get(cache_key)
            if cached is not None:
                return {**cached, "latency_ms": round((time.time() - start_time) * 1000, 1)}

        intent_result = await self.intent_agent.run(user_message, history)
        intent = intent_result.get("intent")
        product_name = intent_result.get("product_name")
        product_name_2 = intent_result.get("product_name_2")
        category = intent_result.get("category")

        if intent == INTENT_IRRELEVANT:
            res = self._finalize(self.responder.reply_irrelevant(), intent, product_name, start_time)
            if cache_key:
                self._cache[cache_key] = res
            return res

        if intent == INTENT_OUT_OF_SCOPE:
            res = self._finalize(self.responder.reply_out_of_scope(), intent, product_name, start_time)
            if cache_key:
                self._cache[cache_key] = res
            return res

        db_keyword = product_name if product_name else user_message
        db_result = await self.db_agent.run(db_keyword, category)

        if intent == INTENT_COMPARE and product_name_2:
            db_result_2 = await self.db_agent.run(product_name_2, category)
            if db_result.get("found") or db_result_2.get("found"):
                db_result["found"] = True
                db_result["products"] = db_result.get("products", []) + db_result_2.get("products", [])
                db_result["search_keyword"] = f"{db_keyword} & {product_name_2}"

        db_match_type = db_result.get("match_type")

        if db_result.get("found") and db_match_type == "exact":
            reply = await self.responder.reply_from_db(db_result, user_message, intent)
            res = self._finalize(reply, intent, db_result.get("search_keyword", db_keyword), start_time)
            if cache_key:
                self._cache[cache_key] = res
            return res

        internet_result = await self.internet_agent.run(db_keyword)
        # Demand-driven pool expansion: queue missing/partial tech queries for multi-store harvesting!
        import db as database
        await database.enqueue_discovery_keyword_async(db_keyword, category)

        if internet_result.get("found"):
            reply = await self.responder.reply_from_internet(internet_result, user_message)
            res = self._finalize(reply, intent, db_keyword, start_time)
            if cache_key:
                self._cache[cache_key] = res
            return res

        if db_result.get("found") and db_match_type == "partial":
            db_result["partial_fallback"] = True
            reply = await self.responder.reply_from_db(db_result, user_message, intent)
            res = self._finalize(reply, intent, db_result.get("search_keyword", db_keyword), start_time)
            if cache_key:
                self._cache[cache_key] = res
            return res

        reply = await self.responder.reply_from_internet(internet_result, user_message)
        return self._finalize(reply, intent, db_keyword, start_time)

    def _finalize(self, result: dict, intent: str, keyword: str | None, start_time: float) -> dict:
        latency = round((time.time() - start_time) * 1000, 1)
        return {
            **result,
            "intent": intent,
            "search_keyword": keyword,
            "latency_ms": latency,
        }
