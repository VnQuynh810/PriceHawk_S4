"""
main.py — FastAPI Entrypoint for PriceHawk Chatbot Service.
"""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import db as database
from pipeline import ChatbotPipeline

load_dotenv()

pipeline: ChatbotPipeline | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline
    pipeline = ChatbotPipeline()
    yield


app = FastAPI(
    title="PriceHawk Chatbot API",
    description="Async AI Chatbot for PriceHawk price comparison platform",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class ProductPrice(BaseModel):
    retailer: str
    price: float | None
    url: str | None


class ChatResponse(BaseModel):
    reply: str
    source: str
    products: list[ProductPrice] = []
    intent: str | None = None
    search_keyword: str | None = None
    latency_ms: float | None = None


@app.get("/")
@app.get("/health")
async def health_check():
    db_ok = await database.is_db_available_async()
    return {
        "status": "ok",
        "service": "PriceHawk Chatbot",
        "db_connected": db_ok,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    msg = request.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")

    history = [{"role": m.role, "content": m.content} for m in request.history]
    result = await pipeline.run(msg, history)

    flat_products = [
        {
            "retailer": p_info.get("retailer", ""),
            "price": p_info.get("price"),
            "url": p_info.get("url"),
        }
        for product in result.get("products", [])
        for p_info in product.get("prices", [])
    ]

    return ChatResponse(
        reply=result.get("reply", ""),
        source=result.get("source", "system"),
        products=flat_products,
        intent=result.get("intent"),
        search_keyword=result.get("search_keyword"),
        latency_ms=result.get("latency_ms"),
    )
