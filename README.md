# PriceHawk S4 🦅

Hệ thống so sánh giá đồ công nghệ (Điện thoại, Laptop, Tablet) tự động theo thời gian thực tại Việt Nam — kiến trúc **Clean Monorepo** gồm Next.js 14 App Router, Python Scrapy Bulk Crawler, FastAPI Async AI Chatbot và Chrome Extension MV3.

## Kiến Trúc Nhanh

- **`apps/web`** — Giao diện & REST API (`Next.js 14.2 LTS`, 100% App Router, Clean 3-Layer `Validator -> Service -> Repository`, Hybrid LRU/Redis Cache, NextAuth RBAC).
- **`apps/crawler`** — Hệ thống cào giá đa sàn (`TGDD`, `FPT Shop`, `Hoàng Hà Mobile`) chạy định kỳ qua `supercronic` + `flock`, bulk upsert chống đốt `AUTO_INCREMENT`, tự động tính `MIN(price)` toàn cục và kích hoạt `price_alert`.
- **`apps/chatbot`** — Trợ lý AI Agentic-RAG (`FastAPI` + `AsyncGroq` + `SearXNG` + `httpx`), 100% non-blocking async, siêu nhẹ (~80MB RAM).
- **`apps/extension`** — Chrome Extension MV3 quét & đối chiếu giá trực tiếp khi lướt sàn TMĐT.
- **`infra/`** — Cấu hình MySQL 8.0 tối ưu (`BIGINT` VND, `FULLTEXT ngram`), Migrations, SearXNG & kịch bản Load Test `k6`.

Xem chi tiết kiến trúc và lộ trình Scaling tại [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Lệnh Chạy Nhanh

```bash
# Chạy môi trường phát triển Web (từ thư mục gốc)
cp .env.example apps/web/.env.local
npm run dev

# Chạy toàn bộ bộ kiểm thử (Unit + HTTP Integration + Security + Golden Normalizer)
npm test

# Đóng gói Chrome Extension mới nhất vào apps/web/public/extension.zip
npm run package:extension

# Chạy toàn bộ hệ thống bằng Docker Compose (Dev)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Chạy Production (Zero-build trên VPS, kéo image từ GHCR)
docker compose pull && docker compose up -d --no-build
```
