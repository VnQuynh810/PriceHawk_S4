/**
 * @jest-environment node
 *
 * Tests for Dynamic Crawl Sources Admin API, Live URL Extractor Sandbox (SSRF + JSON-LD/Hydration),
 * and Dynamic Domain Whitelisting in /api/extension/save.
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
import { extractProductFromHtmlPreview, isSafePublicUrl } from "@/server/services/crawlSourceService";
import { GET, POST, PUT, DELETE } from "@/app/api/admin/sources/route";
import { POST as testExtractPOST } from "@/app/api/admin/sources/test-extract/route";
import { POST as extensionSavePOST } from "@/app/api/extension/save/route";

const adminSession = { user: { id: "1", role: "admin" } };
const normalUserSession = { user: { id: "2", role: "user" } };

beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
  process.env.EXTENSION_API_KEY = "ext-secret";
});

describe("/api/admin/sources — RBAC & CRUD Validation", () => {
  test("chặn user thường (403 Forbidden)", async () => {
    getServerSession.mockResolvedValue(normalUserSession);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("admin tạo nguồn website động mới thành công & chuẩn hóa domain", async () => {
    getServerSession.mockResolvedValue(adminSession);
    db.query.mockResolvedValueOnce({ insertId: 15 });

    const req = new Request("http://localhost:3000/api/admin/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "nguyenkim",
        name: "Nguyễn Kim",
        domain: "https://www.NguyenKim.com/dien-thoai",
        discovery_mode: "sitemap",
        start_urls: ["https://www.nguyenkim.com/sitemap.xml"],
        url_include_pattern: "(dien-thoai|laptop)",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe(15);
    // Domain normalized to "nguyenkim.com"
    expect(db.query.mock.calls[0][1][2]).toBe("nguyenkim.com");
  });

  test("chặn regex không hợp lệ trong url_include_pattern (400)", async () => {
    getServerSession.mockResolvedValue(adminSession);

    const req = new Request("http://localhost:3000/api/admin/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "badregex",
        name: "Bad Regex Shop",
        domain: "badregex.vn",
        start_urls: ["https://badregex.vn/sitemap.xml"],
        url_include_pattern: "[unclosed-group",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("PUT cập nhật trạng thái & DELETE xóa nguồn thành công", async () => {
    getServerSession.mockResolvedValue(adminSession);
    db.query.mockResolvedValueOnce({ affectedRows: 1 });

    const putRes = await PUT(
      new Request("http://localhost:3000/api/admin/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 15, enabled: false, triggerNow: true }),
      })
    );
    expect(putRes.status).toBe(200);

    db.query.mockResolvedValueOnce({ affectedRows: 1 });
    const delRes = await DELETE(
      new Request("http://localhost:3000/api/admin/sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 15 }),
      })
    );
    expect(delRes.status).toBe(200);
  });
});

describe("Live URL Extractor Sandbox & SSRF Protection", () => {
  test("chặn hoàn toàn các địa chỉ IP nội bộ / metadata cloud (SSRF protection)", async () => {
    expect(isSafePublicUrl("http://127.0.0.1:8000/health")).toBe(false);
    expect(isSafePublicUrl("http://localhost:3000/api/health")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.10/admin")).toBe(false);
    expect(isSafePublicUrl("https://phongvu.vn/laptop-apple-macbook")).toBe(true);

    getServerSession.mockResolvedValue(adminSession);
    const req = new Request("http://localhost:3000/api/admin/sources/test-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:8083/search" }),
    });
    const res = await testExtractPOST(req);
    expect(res.status).toBe(400);
  });

  test("extractProductFromHtmlPreview bóc chuẩn cả JSON-LD và __NEXT_DATA__", () => {
    const ldHtml = `
      <html><head>
        <script type="application/ld+json">
          {"@type":"Product","name":"iPhone 16 128GB Đen","brand":{"name":"Apple"},"offers":{"price":"21.490.000"}}
        </script>
      </head></html>
    `;
    const r1 = extractProductFromHtmlPreview(ldHtml);
    expect(r1.strategy).toBe("json_ld");
    expect(r1.price).toBe(21490000);

    const nextHtml = `
      <html><body>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"item":{"title":"Samsung Galaxy S24 Ultra 12GB 256GB","salePrice":25990000}}}}
        </script>
      </body></html>
    `;
    const r2 = extractProductFromHtmlPreview(nextHtml);
    expect(r2.strategy).toBe("hydration_json");
    expect(r2.price).toBe(25990000);
  });
});

describe("Dynamic Trusted Domains Integration with /api/extension/save", () => {
  test("tự động cho phép domain mới được thêm vào bảng crawl_source", async () => {
    db.query
      .mockResolvedValueOnce([{ domain: "techmart247.vn" }]) // findEnabledSourceDomains
      .mockResolvedValueOnce([]) // findProductByIdentityKey
      .mockResolvedValueOnce({ insertId: 888 }) // insert product
      .mockResolvedValueOnce({ affectedRows: 1 }); // insert comparison

    const req = new Request("http://localhost:3000/api/extension/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-key": "ext-secret",
      },
      body: JSON.stringify({
        name: "iPhone 16 Pro 256GB Trắng",
        price: 27490000,
        sourceUrl: "https://techmart247.vn/iphone-16-pro-256gb",
      }),
    });

    const res = await extensionSavePOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.productId).toBe(888);
  });
});
