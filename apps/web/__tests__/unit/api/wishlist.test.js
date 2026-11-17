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
import { GET, POST, DELETE } from "@/app/api/wishlist/route";

function makeRequest(method = "GET", body = null) {
  const init = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== null && method !== "GET") {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/api/wishlist", init);
}

const loggedIn = { user: { id: "42" } };
const anonymous = null;

beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

describe("GET /api/wishlist", () => {
  test("trả về danh sách wishlist của user", async () => {
    getServerSession.mockResolvedValue(loggedIn);
    const fakeData = [{ id: 1, product_id: 10, name: "iPhone 16", current_price: 22000000 }];
    db.query.mockResolvedValue(fakeData);

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: fakeData });
  });

  test("anonymous user nhận mảng rỗng mà không query DB", async () => {
    getServerSession.mockResolvedValue(anonymous);

    const res = await GET(makeRequest("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: [] });
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("POST /api/wishlist", () => {
  test("trả về 401 khi chưa đăng nhập", async () => {
    getServerSession.mockResolvedValue(anonymous);
    const res = await POST(makeRequest("POST", { productId: 10 }));
    expect(res.status).toBe(401);
  });

  test("trả về 400 khi thiếu productId", async () => {
    getServerSession.mockResolvedValue(loggedIn);
    const res = await POST(makeRequest("POST", {}));
    expect(res.status).toBe(400);
  });

  test("trả về 409 khi product đã có trong wishlist", async () => {
    getServerSession.mockResolvedValue(loggedIn);
    db.query.mockResolvedValueOnce([{ id: 5 }]);

    const res = await POST(makeRequest("POST", { productId: 10 }));
    expect(res.status).toBe(409);
  });

  test("thêm thành công khi chưa có trong wishlist", async () => {
    getServerSession.mockResolvedValue(loggedIn);
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const res = await POST(makeRequest("POST", { productId: 10 }));
    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/wishlist", () => {
  test("trả về 401 khi chưa đăng nhập", async () => {
    getServerSession.mockResolvedValue(anonymous);
    const res = await DELETE(makeRequest("DELETE", { productId: 10 }));
    expect(res.status).toBe(401);
  });

  test("xóa thành công với điều kiện user_id chính xác", async () => {
    getServerSession.mockResolvedValue(loggedIn);
    db.query.mockResolvedValue({ affectedRows: 1 });

    const res = await DELETE(makeRequest("DELETE", { productId: 10 }));
    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM wishlist"),
      [10, 42]
    );
  });
});
