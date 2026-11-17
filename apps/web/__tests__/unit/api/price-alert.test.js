/**
 * @jest-environment node
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
import { GET, POST, PUT, DELETE } from "@/app/api/price-alert/route";

function makeRequest(method = "GET", query = {}, body = null, headers = {}) {
  const url = new URL("http://localhost:3000/api/price-alert");
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, String(v));
  });
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== null && method !== "GET") {
    init.body = JSON.stringify(body);
  }
  return new Request(url.toString(), init);
}

const mockLoggedInSession = { user: { id: "42", role: "user" } };
const mockAnonymousSession = null;

beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

describe("GET /api/price-alert", () => {
  test("trả về danh sách alerts của user đã login", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    const fakeAlerts = [{ id: 1, product_id: 10, target_price: 5000000, status: "active" }];
    db.query.mockResolvedValue(fakeAlerts);

    const res = await GET(makeRequest("GET", { status: "active" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ data: fakeAlerts });
  });

  test("anonymous user nhận mảng rỗng ngay lập tức, KHÔNG lộ dữ liệu user_id IS NULL", async () => {
    getServerSession.mockResolvedValue(mockAnonymousSession);

    const res = await GET(makeRequest("GET", { status: "active" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ data: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  test("chặn GET ?action=run-triggers khi không phải admin hoặc không có x-cron-secret", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    const res = await GET(makeRequest("GET", { action: "run-triggers" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/price-alert", () => {
  test("trả về 401 khi chưa đăng nhập", async () => {
    getServerSession.mockResolvedValue(mockAnonymousSession);
    const res = await POST(makeRequest("POST", {}, { productId: 1, targetPrice: 5000000 }));
    expect(res.status).toBe(401);
  });

  test("trả về 400 khi thiếu productId hoặc targetPrice", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    const res = await POST(makeRequest("POST", {}, { productId: 1 }));
    expect(res.status).toBe(400);
  });

  test("trả về 400 khi targetPrice >= giá hiện tại", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    db.query.mockResolvedValueOnce([{ id: 1, current_price: 10000000 }]);

    const res = await POST(makeRequest("POST", {}, { productId: 1, targetPrice: 10000000 }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("thấp hơn");
  });

  test("tạo alert thành công khi targetPrice < giá hiện tại", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    db.query
      .mockResolvedValueOnce([{ id: 1, current_price: 10000000 }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const res = await POST(
      makeRequest("POST", {}, { productId: 1, targetPrice: 7000000, note: "Canh sale" })
    );
    expect(res.status).toBe(201);
  });
});

describe("GET /api/price-alert?action=check-triggers", () => {
  test("trả về triggered=1 khi latest_price <= target_price", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    db.query.mockResolvedValue([
      {
        id: 1,
        product_id: 10,
        target_price: 8000000,
        latest_price: 7500000,
        status: "active",
        name: "iPhone 16",
        brand: "apple",
      },
    ]);

    const res = await GET(makeRequest("GET", { action: "check-triggers" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.triggered).toBe(1);
    expect(data.details[0].triggered).toBe(true);
  });
});

describe("PUT & DELETE /api/price-alert — IDOR Ownership Protection", () => {
  test("PUT kiểm tra đúng user_id và trả về 404 nếu cố sửa alert của user khác", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    db.query.mockResolvedValue({ affectedRows: 0 }); // không khớp user_id = 42

    const res = await PUT(makeRequest("PUT", {}, { alertId: 99, status: "inactive" }));
    expect(res.status).toBe(404);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("AND user_id = ?"),
      ["inactive", 99, 42]
    );
  });

  test("DELETE kiểm tra đúng user_id và xóa thành công khi thuộc sở hữu", async () => {
    getServerSession.mockResolvedValue(mockLoggedInSession);
    db.query.mockResolvedValue({ affectedRows: 1 });

    const res = await DELETE(makeRequest("DELETE", {}, { alertId: 5 }));
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("AND user_id = ?"),
      [5, 42]
    );
  });
});
