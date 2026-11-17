/**
 * @jest-environment node
 *
 * Golden Fixture Parity & Security Tests:
 * 1. Verifies JS normalizer matches packages/shared-fixtures/normalizer_cases.json 100%
 * 2. Verifies /api/extension/save enforces X-Extension-Key / Session + trusted domain whitelist
 * 3. Verifies /api/price-history binds periodChangeSql parameters in exact order
 */

import fs from "fs";
import path from "path";
import { normalizeIdentityByCategory, canonicalizeUrl } from "@/lib/normalizer";

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
import { POST as extensionSavePOST } from "@/app/api/extension/save/route";
import { GET as priceHistoryGET } from "@/app/api/price-history/route";
import { clearAllMemoryCache } from "@/server/cache/cacheAdapter";

describe("Golden Normalizer Parity (JS vs Shared Fixtures)", () => {
  const fixturesPath = path.resolve(
    __dirname,
    "../../../../../packages/shared-fixtures/normalizer_cases.json"
  );
  const cases = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

  test.each(cases)("$description", ({ input, expected }) => {
    const actual = normalizeIdentityByCategory(input.name, input.brand, input.category);
    expect(actual.brandNorm).toBe(expected.brandNorm);
    expect(actual.modelKey).toBe(expected.modelKey);
    expect(actual.variantKey).toBe(expected.variantKey);
    expect(actual.identityKey).toBe(expected.identityKey);
    expect(actual.ramNorm).toBe(expected.ramNorm);
    expect(actual.romNorm).toBe(expected.romNorm);
    expect(actual.colorNorm).toBe(expected.colorNorm);
  });

  test("canonicalizeUrl strips utm_* and fbclid tracking params cleanly", () => {
    expect(
      canonicalizeUrl(
        "https://www.thegioididong.com/may-tinh-bang/honor-pad-x7-wifi-4gb-64gb/?utm_flashsale=1&fbclid=abc123"
      )
    ).toBe("https://www.thegioididong.com/may-tinh-bang/honor-pad-x7-wifi-4gb-64gb");
  });
});

describe("POST /api/extension/save — Security Hardening", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllMemoryCache();
    process.env.EXTENSION_API_KEY = "secret-ext-key";
  });

  test("rejects unauthenticated request without X-Extension-Key (401)", async () => {
    getServerSession.mockResolvedValue(null);
    const req = new Request("http://localhost:3000/api/extension/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "iPhone 16 128GB Đen",
        price: 21990000,
        sourceUrl: "https://www.thegioididong.com/dtdd/iphone-16",
      }),
    });

    const res = await extensionSavePOST(req);
    expect(res.status).toBe(401);
  });

  test("rejects untrusted phishing domain even with valid X-Extension-Key (400)", async () => {
    const req = new Request("http://localhost:3000/api/extension/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-key": "secret-ext-key",
      },
      body: JSON.stringify({
        name: "iPhone 16 128GB Đen",
        price: 1000000,
        sourceUrl: "https://evil-phishing-shop.example.com/iphone-16",
      }),
    });

    const res = await extensionSavePOST(req);
    expect(res.status).toBe(400);
  });

  test("saves trusted retailer product with source='extension' when X-Extension-Key matches", async () => {
    db.query
      .mockResolvedValueOnce([]) // findProductByIdentityKey -> none
      .mockResolvedValueOnce({ insertId: 777 }) // insert product
      .mockResolvedValueOnce({ affectedRows: 1 }); // insert comparison

    const req = new Request("http://localhost:3000/api/extension/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-key": "secret-ext-key",
      },
      body: JSON.stringify({
        name: "iPhone 16 128GB Đen",
        price: 21990000,
        sourceUrl: "https://www.thegioididong.com/dtdd/iphone-16?utm_source=fb",
      }),
    });

    const res = await extensionSavePOST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.source).toBe("extension");
    expect(body.productId).toBe(777);
  });
});

describe("GET /api/price-history — Fixed SQL Parameter Binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllMemoryCache();
  });

  test("passes exact 5 parameters [halfDays, days, halfDays, productId, days] to periodChangeSql", async () => {
    db.query
      .mockResolvedValueOnce([
        { day: "2026-05-28", yearweek: 202622, week_start: "2026-05-25", price: 18000000, retailer: "tgdd" },
      ])
      .mockResolvedValueOnce([{ this_period_min: 18000000, prev_period_min: 20000000 }]);

    const req = new Request("http://localhost:3000/api/price-history?id=1301&range=30d");
    const res = await priceHistoryGET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.query.mock.calls[1][1]).toEqual([15, 30, 15, 1301, 30]);
    expect(body.periodChangePercent).toBe(-10);
    expect(body.periodChangeTrend).toBe("down");
  });
});
