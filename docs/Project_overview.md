# PriceHawk S4 v2.0 — Project Overview & Engineering Rules

**Cập nhật lần cuối:** 17/11/2026 — Refactor toàn diện sang **Clean Monorepo Architecture**, 100% App Router, tối ưu hiệu năng (`BIGINT`, `FULLTEXT ngram`, Hybrid LRU/Redis Cache, Bulk Upsert Crawler, Async Lightweight Chatbot) và chuẩn hóa Docker + CI/CD GHCR.

---

## 1. Tổng Quan Hệ Thống

- **Mục đích:** Nền tảng theo dõi & so sánh giá đồ điện tử (điện thoại, laptop, tablet) tự động theo thời gian thực từ các nhà bán lẻ lớn tại Việt Nam (`Thế Giới Di Động`, `FPT Shop`, `Hoàng Hà Mobile`, cộng đồng qua `Chrome Extension`).
- **Tech Stack v2.0:**
  - **Web & API (`apps/web`):** Next.js `14.2.35` LTS (100% App Router, `output: "standalone"`), React 18, Tailwind CSS 3.4, Zod, MySQL2 Promise Pool, Hybrid Cache (`lru-cache` L1 + `ioredis` L2 tùy chọn), NextAuth v4 JWT RBAC.
  - **Crawler (`apps/crawler`):** Python 3.12, Scrapy, PyMySQL Bulk Writer, Supercronic + `flock` (non-root).
  - **AI Chatbot (`apps/chatbot`):** FastAPI, `AsyncGroq` (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`), `httpx` + `BeautifulSoup4` + `SearXNG`, `TTLCache`.
  - **Extension (`apps/extension`):** Chrome Extension Manifest V3 (Side Panel + Picker).
  - **Hạ tầng (`infra/`):** MySQL 8.0 (`my.cnf` tối ưu cho VPS 1GB+, `BIGINT` VND, `FULLTEXT WITH PARSER ngram`), SearXNG, k6 Load Test, GitHub Actions CI/CD đẩy image lên `ghcr.io`.

---

## 2. Cấu Trúc Thư Mục Chuẩn (Monorepo)

```text
PriceHawk_S4/
├── apps/
│   ├── web/                       # Next.js 14.2 App Router
│   │   ├── src/
│   │   │   ├── app/               # UI Pages & app/api/*/route.js
│   │   │   ├── components/        # Navbar, ProductBrowser, SearchCard, PriceHistoryChart...
│   │   │   ├── server/            # SERVER-ONLY ('server-only')
│   │   │   │   ├── db/pool.js     # Singleton MySQL2 Promise Pool DUY NHẤT
│   │   │   │   ├── cache/         # cacheAdapter.js (LRU Memory + Redis auto-switch)
│   │   │   │   ├── validators/    # schemas.js (Zod input & domain validation)
│   │   │   │   ├── repositories/  # product, wishlist, alert, user SQL repositories
│   │   │   │   └── services/      # Business logic + cache invalidation
│   │   │   ├── lib/               # apiClient.js, auth.js, normalizer.js, swagger.js
│   │   │   └── middleware.js      # Bảo vệ /admin/* (BẮT BUỘC đặt tại src/middleware.js)
│   │   ├── public/                # default-product.svg, extension.zip
│   │   ├── __tests__/             # Jest Unit, HTTP Integration & Security Tests
│   │   └── Dockerfile             # Node 20 Alpine multi-stage (~130MB)
│   ├── crawler/                   # Scrapy + BulkDBWriter + Supercronic Dockerfile
│   ├── chatbot/                   # FastAPI AsyncGroq + httpx Dockerfile (~180MB)
│   └── extension/                 # Chrome Extension MV3
├── infra/
│   ├── mysql/                     # my.cnf, schema/000_init_schema.sql, migrations/001..003
│   ├── searxng/settings.yml
│   └── k6/test.js
├── packages/
│   └── shared-fixtures/normalizer_cases.json
├── docs/                          # ARCHITECTURE.md, Project_overview.md, DEPLOY.md...
├── scripts/package-extension.mjs
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## 3. Quy Tắc Kiến Trúc Bất Di Bất Dịch (Anti-Patterns Cần Tránh)

1. **Tầng Web/API (`apps/web`):**
   - ❌ **KHÔNG** tạo lại thư mục `pages/api/` — 100% API nằm tại `apps/web/src/app/api/*/route.js`.
   - ❌ **KHÔNG** viết SQL trực tiếp trong `route.js` hay React Component — mọi SQL phải nằm trong `src/server/repositories/*.js`.
   - ❌ **KHÔNG** tạo connection MySQL mới ngoài `src/server/db/pool.js`.
   - ❌ **KHÔNG** gọi `axios.get("/api/...")` trực tiếp trong UI Component — luôn import hàm từ `@/lib/apiClient`.
   - ❌ **KHÔNG** di chuyển `apps/web/src/middleware.js` ra khỏi `src/` — Next.js yêu cầu `middleware.js` nằm ngang hàng với `src/app/`.
   - ❌ **KHÔNG** sửa/xóa `wishlist` hoặc `price_alert` mà thiếu điều kiện `AND user_id = ?` (chống IDOR).
2. **Chuẩn hóa sản phẩm (`normalizer.js` & `normalizer.py`):**
   - Mọi thay đổi trên thuật toán trích xuất `brand`, `model_key`, `variant_key`, `identity_key` **BẮT BUỘC** cập nhật đồng thời cả JS lẫn Python và thêm test case vào `packages/shared-fixtures/normalizer_cases.json` (verify bằng `npm test` và `pytest`).
3. **Crawler & Chatbot:**
   - ❌ **KHÔNG** bật lại `FEEDS` xuất `.jsonl` theo timestamp trong `settings.py` (gây đầy ổ cứng VPS).
   - ❌ **KHÔNG** cài đặt Playwright / Chromium / `crawl4ai` vào `apps/chatbot` (gây OOM trên VPS giới hạn RAM) và không dùng client đồng bộ `Groq()` chặn Uvicorn event loop — luôn dùng `AsyncGroq`.
4. **Docker & Deploy:**
   - ❌ **KHÔNG** chạy `docker compose build` trực tiếp trên VPS 1GB RAM — mọi image được build tự động trên GitHub Actions (`.github/workflows/cd.yml`), đẩy lên `ghcr.io`, và VPS chỉ chạy `docker compose pull && docker compose up -d --no-build`.
