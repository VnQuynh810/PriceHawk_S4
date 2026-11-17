import "server-only";
import { normalizeIdentityByCategory, canonicalizeUrl } from "@/lib/normalizer";
import { cacheInvalidatePrefix } from "@/server/cache/cacheAdapter";
import {
  findProductByIdentityKey,
  insertProductFromExtension,
} from "@/server/repositories/productRepository";

function inferRetailerSlug(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes("thegioididong") || host.includes("topzone") || host.includes("dienmayxanh")) return "tgdd";
    if (host.includes("fptshop")) return "fpt";
    if (host.includes("hoanghamobile")) return "hoangha";
    if (host.includes("cellphones")) return "cellphones";
    return host.replace(/^www\./, "").split(".")[0] || "extension";
  } catch {
    return "extension";
  }
}

export async function compareExtensionProductService({ name, price, brand, category }) {
  const normalized = normalizeIdentityByCategory(name, brand, category);
  const identityKey = normalized.identityKey;

  if (!identityKey) {
    return {
      ok: false,
      status: 422,
      body: {
        found: false,
        error: "Could not normalize product name",
        normalizedResult: normalized,
      },
    };
  }

  const matched = await findProductByIdentityKey(identityKey);
  if (!matched) {
    return {
      ok: true,
      status: 200,
      body: {
        found: false,
        identityKey,
        normalizedResult: normalized,
      },
    };
  }

  const currentPrice = Number.isFinite(Number(price)) ? Math.round(Number(price)) : null;
  const dbPrice = matched.current_price !== null ? Number(matched.current_price) : null;
  const priceDiff =
    currentPrice !== null && dbPrice !== null ? Math.round(currentPrice - dbPrice) : null;

  return {
    ok: true,
    status: 200,
    body: {
      found: true,
      identityKey,
      normalizedResult: normalized,
      matchedProduct: {
        id: matched.id,
        name: matched.name,
        brand: matched.brand,
        imageUrl: matched.image_url,
        price: dbPrice,
      },
      currentPrice,
      priceDiff,
    },
  };
}

export async function saveExtensionProductService({
  name,
  price,
  sourceUrl,
  brand,
  category,
}) {
  const normalized = normalizeIdentityByCategory(name, brand, category);
  const identityKey = normalized.identityKey;

  if (!identityKey) {
    return {
      ok: false,
      status: 422,
      body: { error: "Could not normalize product name" },
    };
  }

  const existing = await findProductByIdentityKey(identityKey);
  if (existing) {
    return {
      ok: true,
      status: 200,
      body: {
        duplicate: true,
        productId: existing.id,
        identityKey,
      },
    };
  }

  const cleanUrl = canonicalizeUrl(sourceUrl);
  const currentPrice =
    price !== null && price !== undefined && Number.isFinite(Number(price))
      ? Math.round(Number(price))
      : null;

  const productId = await insertProductFromExtension({
    name: name.trim(),
    currentPrice,
    brandNorm: normalized.brandNorm ?? null,
    category: category ?? null,
    identityKey,
    sourceUrl: cleanUrl,
    retailerName: inferRetailerSlug(cleanUrl),
  });

  await cacheInvalidatePrefix("product:");

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      productId,
      identityKey,
      source: "extension",
      normalizedResult: normalized,
    },
  };
}
