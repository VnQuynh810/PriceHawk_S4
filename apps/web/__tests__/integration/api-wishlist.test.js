/**
 * @jest-environment node
 */

import { createServer } from "http";

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
import * as wishlistRoute from "@/app/api/wishlist/route";

function startRouteServer(routeModule) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const handler = routeModule[req.method];
      if (!handler) {
        res.statusCode = 405;
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
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

let ctx;
beforeAll(async () => {
  ctx = await startRouteServer(wishlistRoute);
});
afterAll(() => new Promise((resolve) => ctx.server.close(resolve)));
beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

describe("Integration: /api/wishlist", () => {
  test("lifecycle GET -> POST -> DELETE cho user đã đăng nhập", async () => {
    getServerSession.mockResolvedValue({ user: { id: "7" } });

    db.query.mockResolvedValueOnce([]);
    const getRes = await fetch(`${ctx.baseUrl}/api/wishlist`);
    expect(getRes.status).toBe(200);

    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const postRes = await fetch(`${ctx.baseUrl}/api/wishlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 99 }),
    });
    expect(postRes.status).toBe(201);

    db.query.mockResolvedValueOnce({ affectedRows: 1 });
    const delRes = await fetch(`${ctx.baseUrl}/api/wishlist`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 99 }),
    });
    expect(delRes.status).toBe(200);
  });
});
