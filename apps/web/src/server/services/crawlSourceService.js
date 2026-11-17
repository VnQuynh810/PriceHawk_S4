import "server-only";
import { normalizeIdentityByCategory, canonicalizeUrl } from "@/lib/normalizer";
import { cacheInvalidatePrefix, remember } from "@/server/cache/cacheAdapter";
import { ALLOWED_RETAILER_DOMAINS } from "@/server/validators/schemas";
import {
  listAllCrawlSources,
  findEnabledSourceDomains,
  insertCrawlSource,
  updateCrawlSourceById,
  deleteCrawlSourceById,
} from "@/server/repositories/crawlSourceRepository";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
];

export function isSafePublicUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return !PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export async function isDynamicallyTrustedRetailerUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();

    // Fast-path: check built-in trusted domains without touching DB
    if (ALLOWED_RETAILER_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
      return true;
    }

    // Dynamic fallback: check enabled domains added via Admin `crawl_source`
    const dynamicDomains = await remember("crawl:trusted_domains", 300, () =>
      findEnabledSourceDomains()
    );
    return dynamicDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function getCrawlSourcesService() {
  return listAllCrawlSources();
}

export async function createCrawlSourceService(payload) {
  try {
    const id = await insertCrawlSource(payload);
    await cacheInvalidatePrefix("crawl:");
    return { ok: true, status: 201, id };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return { ok: false, status: 409, error: "Mã nguồn cào (code) đã tồn tại" };
    }
    throw err;
  }
}

export async function updateCrawlSourceService(id, patch) {
  const affected = await updateCrawlSourceById(id, patch);
  if (!affected) {
    return { ok: false, status: 404, error: "Không tìm thấy nguồn cào" };
  }
  await cacheInvalidatePrefix("crawl:");
  return { ok: true, status: 200 };
}

export async function deleteCrawlSourceService(id) {
  const affected = await deleteCrawlSourceById(id);
  if (!affected) {
    return { ok: false, status: 404, error: "Không tìm thấy nguồn cào" };
  }
  await cacheInvalidatePrefix("crawl:");
  return { ok: true, status: 200 };
}

// ─── Multi-Stage Universal HTML Preview Extractor (Admin Live Sandbox) ────────

function parseVndPriceJs(raw) {
  if (raw === null || raw === undefined || typeof raw === "boolean") return null;
  if (typeof raw === "number") {
    const v = Math.round(raw);
    return v >= 50000 && v <= 500000000 ? v : null;
  }
  const s = String(raw).trim();
  if (!s || /liên hệ|lien he/i.test(s)) return null;
  if (/^\d+\.\d{1,2}$/.test(s)) {
    const v = Math.round(parseFloat(s));
    return v >= 50000 && v <= 500000000 ? v : null;
  }
  const m = s.match(/(\d{1,3}(?:[.,]\d{3})+|\d{5,9})/);
  if (!m) return null;
  const v = parseInt(m[1].replace(/\D/g, ""), 10);
  return v >= 50000 && v <= 500000000 ? v : null;
}

function findLdProductJs(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findLdProductJs(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    const t = node["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
    for (const v of Object.values(node)) {
      const hit = findLdProductJs(v);
      if (hit) return hit;
    }
  }
  return null;
}

function walkHydrationProductJs(node, depth = 0) {
  if (!node || depth > 12) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 25)) {
      const hit = walkHydrationProductJs(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    const name = node.name || node.productName || node.title;
    const rawPrice =
      node.special_price ?? node.salePrice ?? node.finalPrice ?? node.currentPrice ?? node.price;
    const price = parseVndPriceJs(rawPrice);
    if (typeof name === "string" && name.trim().length >= 4 && price) {
      const img = node.image || node.imageUrl || node.thumbnail || null;
      const brandVal = node.brand || node.manufacturer || null;
      return {
        name: name.trim(),
        price,
        brand: typeof brandVal === "object" ? brandVal?.name : brandVal,
        imageUrl: typeof img === "string" ? img : Array.isArray(img) ? img[0] : img?.url || null,
      };
    }
    for (const v of Object.values(node)) {
      const hit = walkHydrationProductJs(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function extractProductFromHtmlPreview(html) {
  // 1. JSON-LD
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRegex.exec(html)) !== null) {
    try {
      const cleaned = m[1].trim().replace(/,\s*([}\]])/g, "$1");
      const prod = findLdProductJs(JSON.parse(cleaned));
      if (prod) {
        const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers || {};
        const price =
          parseVndPriceJs(offers.lowPrice) ||
          parseVndPriceJs(offers.price) ||
          parseVndPriceJs(offers.highPrice);
        if (prod.name && price) {
          const img = prod.image;
          return {
            strategy: "json_ld",
            name: String(prod.name).trim(),
            price,
            brand: typeof prod.brand === "object" ? prod.brand?.name : prod.brand || null,
            imageUrl: typeof img === "string" ? img : Array.isArray(img) ? img[0] : img?.url || null,
          };
        }
      }
    } catch {}
  }

  // 2. __NEXT_DATA__ Hydration JSON
  const nextMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      const hit = walkHydrationProductJs(JSON.parse(nextMatch[1]));
      if (hit) return { strategy: "hydration_json", ...hit };
    } catch {}
  }

  // 3. OpenGraph / Microdata / H1
  const ogTitle =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ")?.trim() ||
    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim();
  const ogPriceRaw =
    html.match(/<meta[^>]*property=["'](?:product|og):price:amount["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const ogImg =
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
  const ogPrice = parseVndPriceJs(ogPriceRaw);

  if (ogTitle && ogPrice) {
    return {
      strategy: "opengraph_microdata",
      name: ogTitle.replace(/\s+/g, " "),
      price: ogPrice,
      brand: null,
      imageUrl: ogImg,
    };
  }

  return {
    strategy: null,
    name: ogTitle ? ogTitle.replace(/\s+/g, " ") : null,
    price: ogPrice,
    brand: null,
    imageUrl: ogImg,
    needsJsRender: /id=["'](?:root|app|__next)["']/i.test(html) && !ogPrice,
  };
}

export async function testLiveProductUrlService(rawUrl, category = null) {
  if (!isSafePublicUrl(rawUrl)) {
    return {
      ok: false,
      status: 400,
      error: "URL không hợp lệ hoặc trỏ tới mạng nội bộ bị chặn (SSRF protection).",
    };
  }

  const cleanUrl = canonicalizeUrl(rawUrl);
  const res = await fetch(cleanUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });

  const html = await res.text();
  const extracted = extractProductFromHtmlPreview(html);
  const normalized = extracted.name
    ? normalizeIdentityByCategory(extracted.name, extracted.brand, category)
    : null;

  return {
    ok: true,
    status: 200,
    data: {
      httpStatus: res.status,
      canonicalUrl: cleanUrl,
      success: Boolean(extracted.name && extracted.price),
      strategy: extracted.strategy,
      needsJsRender: Boolean(extracted.needsJsRender),
      extracted,
      normalized,
    },
  };
}
