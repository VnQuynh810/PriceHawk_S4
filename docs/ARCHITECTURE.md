# PriceHawk S4 v2.1 — Clean Monorepo & Dynamic Multi-Website Crawler Architecture

## 1. Cấu Trúc Monorepo

```text
PriceHawk_S4/
├── apps/
│   ├── web/                       # Next.js 14.2 LTS (100% App Router, Standalone Output)
│   │   ├── src/
│   │   │   ├── app/               # RSC Pages, /admin Control Center & app/api/*/route.js
│   │   │   ├── components/        # Reusable UI & AdminDashboardClient
│   │   │   ├── server/            # Server-only Clean Architecture Core
│   │   │   │   ├── db/pool.js     # Singleton MySQL2 Promise Pool (budgeted)
│   │   │   │   ├── cache/         # 2-Tier Hybrid Cache (L1 LRU Memory + L2 Redis)
│   │   │   │   ├── validators/    # Zod Input, Regex & SSRF Guards
│   │   │   │   ├── repositories/  # product, wishlist, alert, user, crawlSource Repos
│   │   │   │   └── services/      # Business Logic + Live HTML Universal Extractor
│   │   │   ├── lib/               # apiClient.js, auth.js, normalizer.js, swagger.js
│   │   │   └── middleware.js      # Edge RBAC Guard for /admin/*
│   │   └── Dockerfile             # Multi-stage Node 20 Alpine (~130MB, non-root)
│   │
│   ├── crawler/                   # Config-Driven Multi-Site Universal Crawler Platform
│   │   ├── scheduler.py           # Staggered DB Scheduler + Hot-SKU Fast-Track + Redis Queue
│   │   ├── dynamic_worker.py      # Resource-Blocked Playwright + curl_cffi TLS Worker
│   │   ├── price_hawk/
│   │   │   ├── extractors/        # 5-Stage UniversalExtractor + Groq AISelectorHealer
│   │   │   ├── spiders/           # universal_catalog + tgdd/fpt/hoangha/cellphones
│   │   │   ├── normalizer.py      # 100% Parity with JS via Golden Fixtures
│   │   │   └── db_batch_processor.py # Bulk Upsert + Global MIN(price) + Alert Trigger
│   │   ├── Dockerfile             # Fast HTTP Tier (Python 3.12-slim + Supercronic)
│   │   └── Dockerfile.dynamic     # Optional Headless JS Worker (--profile dynamic)
│   │
│   ├── chatbot/                   # FastAPI Async Agentic-RAG Service (~180MB, AsyncGroq)
│   └── extension/                 # Chrome Extension MV3 (PriceHawk Scanner)
│
├── infra/
│   ├── mysql/                     # my.cnf, 000_init_schema.sql, migrations/001..004, seeds/
│   ├── searxng/settings.yml
│   └── k6/test.js
├── packages/
│   └── shared-fixtures/normalizer_cases.json
└── docker-compose.yml             # Profiles: default, `scale` (Redis), `dynamic` (Playwright)
```

---

## 2. Cơ Chế Cào Động Đa Website (Universal Multi-Site Crawler)

1. **Thêm Website Không Cần Sửa Code (`/admin` -> `crawl_source`):**
   - Quản trị viên thêm bất kỳ sàn TMĐT mới nào ngay trên giao diện `/admin` (kèm công cụ **Universal URL Sandbox** bóc thử trực tiếp 1 URL trước khi lưu).
   - Domain mới được tự động thêm vào danh sách tin cậy của Chrome Extension (`/api/extension/save`).
2. **4 Chế Độ Khám Phá Link (`UniversalCatalogSpider`):**
   - `sitemap`: Đọc đệ quy `<sitemapindex>` & `.xml.gz`, tự dò `/robots.txt` và đối chiếu `<lastmod>` qua bảng `crawl_url_state` để **bỏ qua các trang không đổi giá**.
   - `html_listing`: Phân trang danh mục HTML + lọc link bằng Regex/CSS.
   - `json_api`: Bóc trực tiếp JSON REST API theo dot-path.
   - `builtin_spider`: Chạy các spider chuyên biệt tốc độ cao (`tgdd_catalog`, `fpt_catalog`, `hoangha_catalog`, `cellphones_catalog`).
3. **Thác Bóc Tách 5 Tầng + AI Tự Hàn Gắn Selector (`UniversalExtractor` + `AISelectorHealer`):**
   - `Custom/Healed CSS` → `Schema.org JSON-LD` → `Hydration State (__NEXT_DATA__ / __NUXT__)` → `OpenGraph / Microdata` → `Heuristic VND DOM`.
   - Khi website đổi giao diện khiến cả 5 tầng thất bại, `AISelectorHealer` gửi khung DOM rút gọn sang Groq (`llama-3.1-8b-instant`) tối đa **1 lần/domain**, kiểm chứng selector trả về trên DOM thật rồi lưu ngược vào `crawl_source.selectors_json`.
4. **Leo Thang Động Tiết Kiệm RAM (`auto_escalate`):**
   - 90% trang chạy qua HTTP thuần siêu nhẹ; chỉ những URL SPA rỗng (`#root`) hoặc dính chặn TLS/JS mới được đẩy sang hàng đợi Redis `pricehawk:queue:dynamic_render` để `dynamic-worker` xử lý bằng `curl_cffi` TLS impersonation hoặc Chromium đã **chặn tải ảnh/font/media/quảng cáo** (giảm ~70% RAM).

---

## 3. Lệnh Vận Hành Theo Từng Quy Mô

```bash
# 1. Quy mô VPS 1GB-2GB (HTTP + Universal Sitemap/JSON-LD/Hydration cho 10-25 sàn):
docker compose up -d

# 2. Quy mô VPS 2GB-4GB (Bật Redis Shared Cache + Distributed Queue):
REDIS_URL=redis://redis:6379 docker compose --profile scale up -d

# 3. Bật thêm Worker Playwright chuyên trị các web SPA/JS nặng:
REDIS_URL=redis://redis:6379 docker compose --profile scale --profile dynamic up -d
```
