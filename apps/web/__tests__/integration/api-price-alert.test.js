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
import * as alertRoute from "@/app/api/price-alert/route";

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
  ctx = await startRouteServer(alertRoute);
});
afterAll(() => new Promise((resolve) => ctx.server.close(resolve)));
beforeEach(() => {
  jest.clearAllMocks();
  clearAllMemoryCache();
});

describe("Integration: /api/price-alert", () => {
  test("lifecycle POST -> PUT -> DELETE với kiểm tra quyền sở hữu", async () => {
    getServerSession.mockResolvedValue({ user: { id: "12", role: "user" } });

    db.query
      .mockResolvedValueOnce([{ id: 5, current_price: 20000000 }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const postRes = await fetch(`${ctx.baseUrl}/api/price-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: 5, targetPrice: 17000000 }),
    });
    expect(postRes.status).toBe(201);

    db.query.mockResolvedValueOnce({ affectedRows: 1 });
    const putRes = await fetch(`${ctx.baseUrl}/api/price-alert`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: 3, status: "inactive" }),
    });
    expect(putRes.status).toBe(200);

    db.query.mockResolvedValueOnce({ affectedRows: 1 });
    const delRes = await fetch(`${ctx.baseUrl}/api/price-alert`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: 3 }),
    });
    expect(delRes.status).toBe(200);
  });
});
