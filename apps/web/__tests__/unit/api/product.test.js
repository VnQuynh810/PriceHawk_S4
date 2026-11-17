/**
 * @jest-environment node
 */

jest.mock("@/server/db/pool", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  query: jest.fn(),
}));

import db from "@/server/db/pool";
import { clearAllMemoryCache } from "@/server/cache/cacheAdapter";
import { GET } from "@/app/api/product/route";

function makeRequest(params = {}) {
  const url = new URL("http://localhost:3000/api/product");
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, String(v));
  });
  return new Request(url.toString(), { method: "GET" });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

const fakeProducts = [
  { id: 1, name: "iPhone 16", brand: "apple", current_price: 22000000, min_price: 22000000 },
  { id: 2, name: "Samsung S25", brand: "samsung", current_price: 18000000, min_price: 18000000 },
];

describe("GET /api/product — paginated list", () => {
  test("trả về danh sách sản phẩm có phân trang kèm Cache-Control header", async () => {
    db.query
      .mockResolvedValueOnce([{ total: 100 }])
      .mockResolvedValueOnce(fakeProducts);

    const res = await GET(makeRequest({ page: 1, pageSize: 2 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    expect(body).toEqual({ data: fakeProducts, totalCount: 100 });
  });

  test("chặn pageSize vượt quá giới hạn 50 (chống DoS)", async () => {
    const res = await GET(makeRequest({ page: 1, pageSize: 99999 }));
    expect(res.status).toBe(400);
  });

  test("fallback về page=1, pageSize=10 khi không truyền param", async () => {
    db.query
      .mockResolvedValueOnce([{ total: 50 }])
      .mockResolvedValueOnce(fakeProducts);

    const res = await GET(makeRequest({}));
    expect(res.status).toBe(200);
    expect(db.query.mock.calls[1][1]).toEqual([10, 0]);
  });

  test("trả về 500 khi DB lỗi", async () => {
    db.query.mockRejectedValue(new Error("DB unavailable"));
    const res = await GET(makeRequest({ page: 1 }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/product?id=X — single product", () => {
  test("trả về product đúng khi tìm theo id", async () => {
    db.query.mockResolvedValue([fakeProducts[0]]);

    const res = await GET(makeRequest({ id: 1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([fakeProducts[0]]);
  });

  test("trả về mảng rỗng khi không tìm thấy id", async () => {
    db.query.mockResolvedValue([]);

    const res = await GET(makeRequest({ id: 9999 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});
