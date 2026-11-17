/**
 * @jest-environment node
 *
 * Full HTTP Integration Test for App Router /api/product
 */

import { createServer } from "http";

jest.mock("@/server/db/pool", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  query: jest.fn(),
}));

import db from "@/server/db/pool";
import { clearAllMemoryCache } from "@/server/cache/cacheAdapter";
import * as productRoute from "@/app/api/product/route";

function startRouteServer(routeModule) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const handler = routeModule[req.method];
      if (!handler) {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }

      const chunks = [];
      for await (const c of req) chunks.push(c);
      const bodyBuf = Buffer.concat(chunks);

      const webReq = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method) || !bodyBuf.length ? undefined : bodyBuf,
      });

      const webRes = await handler(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await webRes.text());
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let ctx;
beforeAll(async () => {
  ctx = await startRouteServer(productRoute);
});
afterAll(() => new Promise((resolve) => ctx.server.close(resolve)));
beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

const fakeProducts = [
  { id: 1, name: "iPhone 16 Pro Max", brand: "apple", current_price: 33990000, min_price: 33990000 },
  { id: 2, name: "Samsung Galaxy S25 Ultra", brand: "samsung", current_price: 29990000, min_price: 29990000 },
];

describe("Integration: GET /api/product", () => {
  test("trả về 200 + data + totalCount qua HTTP thật", async () => {
    db.query
      .mockResolvedValueOnce([{ total: 50 }])
      .mockResolvedValueOnce(fakeProducts);

    const res = await fetch(`${ctx.baseUrl}/api/product?page=1&pageSize=2`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.totalCount).toBe(50);
    expect(body.data).toHaveLength(2);
  });

  test("trả về 405 cho POST", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/product`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  test("trả về product theo id", async () => {
    db.query.mockResolvedValue([fakeProducts[0]]);
    const res = await fetch(`${ctx.baseUrl}/api/product?id=1`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body[0].name).toBe("iPhone 16 Pro Max");
  });
});
