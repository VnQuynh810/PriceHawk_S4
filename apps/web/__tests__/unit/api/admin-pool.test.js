/**
 * @jest-environment node
 *
 * Tests for Autonomous Self-Expanding Product Pool:
 *  1. Bulk Seed Parsing (mixed keywords + URLs + SSRF rejection + deduplication)
 *  2. /api/admin/pool RBAC & CRUD (GET stats, POST bulk seeds, DELETE purge)
 *  3. Demand-Driven Search Miss Hook (enqueues once per 30m via LRU throttle)
 *  4. Throttled View Promotion Hook (promotes viewed product to WARM tier once per 5m)
 */

jest.mock("@/server/db/pool", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  query: jest.fn(),
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import db from "@/server/db/pool";
import { getServerSession } from "next-auth";
import { clearAllMemoryCache } from "@/server/cache/cacheAdapter";
import {
  parseSeedInputLines,
  recordSearchMissForPoolExpansion,
  recordProductViewForWarmTier,
  resetPoolThrottlesForTest,
} from "@/server/services/poolService";
import { GET, POST, DELETE } from "@/app/api/admin/pool/route";

const adminSession = { user: { id: "1", role: "admin" } };
const userSession = { user: { id: "2", role: "user" } };

beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
  resetPoolThrottlesForTest();
});

describe("parseSeedInputLines — Mixed Keyword & URL Classification", () => {
  test("phân loại chuẩn keyword vs URL, khử trùng lặp, cắt utm và chặn SSRF nội bộ", () => {
    const raw = [
      "iPhone 17 Air 256GB",
      "iphone 17 air 256gb", // duplicate case-insensitive -> skipped!
      "https://phongvu.vn/macbook-pro-m4?utm_source=fb",
      "http://127.0.0.1:8080/internal-secret", // SSRF -> blocked!
      "ab", // too short -> skipped!
    ].join("\n");

    const parsed = parseSeedInputLines(raw, "dien-thoai");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      seedType: "keyword",
      queryOrUrl: "iPhone 17 Air 256GB",
      origin: "admin_seed",
      priority: 1,
    });
    expect(parsed[1]).toMatchObject({
      seedType: "url",
      queryOrUrl: "https://phongvu.vn/macbook-pro-m4",
      origin: "admin_seed",
      priority: 1,
    });
  });
});

describe("/api/admin/pool — RBAC & Bulk Seed Lifecycle", () => {
  test("chặn user không phải admin (403)", async () => {
    getServerSession.mockResolvedValue(userSession);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("GET trả về thống kê 4 tầng nhiệt độ (HOT/WARM/COLD/DORMANT) & queue", async () => {
    getServerSession.mockResolvedValue(adminSession);
    db.query
      .mockResolvedValueOnce([
        {
          totalProducts: 1500,
          activeProducts: 1450,
          dormantProducts: 50,
          multiRetailerProducts: 920,
          hotProducts: 80,
          warmProducts: 370,
        },
      ])
      .mockResolvedValueOnce([
        { status: "pending", cnt: 12 },
        { status: "completed", cnt: 240 },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hotProducts).toBe(80);
    expect(body.warmProducts).toBe(370);
    expect(body.coldProducts).toBe(1000); // 1450 - 80 - 370
    expect(body.dormantProducts).toBe(50);
    expect(body.queueStats.pending).toBe(12);
  });

  test("POST bơm hàng loạt hạt giống thành công (201) & DELETE dọn lịch sử xong", async () => {
    getServerSession.mockResolvedValue(adminSession);
    db.query.mockResolvedValueOnce({ affectedRows: 2 });

    const postRes = await POST(
      new Request("http://localhost:3000/api/admin/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seeds: "MacBook Pro M4 16GB 512GB\nhttps://didongviet.vn/iphone-16.html",
          category: "laptop",
        }),
      })
    );
    const postBody = await postRes.json();
    expect(postRes.status).toBe(201);
    expect(postBody.queuedCount).toBe(2);

    db.query.mockResolvedValueOnce({ affectedRows: 10 });
    const delRes = await DELETE(
      new Request("http://localhost:3000/api/admin/pool", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purgeFinished: true }),
      })
    );
    expect(delRes.status).toBe(200);
  });
});

describe("Demand-Driven Search Miss & Throttled View Promotion Hooks", () => {
  test("recordSearchMissForPoolExpansion chỉ ghi DB 1 lần cho cùng từ khóa trong cửa sổ throttle", async () => {
    db.query.mockResolvedValue({ affectedRows: 1 });

    const first = await recordSearchMissForPoolExpansion("Xiaomi 15 Ultra");
    const second = await recordSearchMissForPoolExpansion("xiaomi 15 ultra"); // throttled!

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test("recordProductViewForWarmTier tăng view_count có throttle 5 phút/sản phẩm", async () => {
    db.query.mockResolvedValue({ affectedRows: 1 });

    const v1 = await recordProductViewForWarmTier(1301);
    const v2 = await recordProductViewForWarmTier(1301); // throttled!

    expect(v1).toBe(true);
    expect(v2).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("view_count = view_count + 1"),
      [1301]
    );
  });
});
