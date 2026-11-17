import "server-only";
import { LRUCache } from "lru-cache";
import { canonicalizeUrl } from "@/lib/normalizer";
import { isSafePublicUrl } from "@/server/services/crawlSourceService";
import {
  insertDiscoverySeedsBatch,
  incrementProductViewCount,
  fetchPoolOverviewStats,
  deleteDiscoverySeed,
  purgeCompletedDiscoverySeeds,
} from "@/server/repositories/poolRepository";

const viewThrottle = new LRUCache({ max: 2000, ttl: 5 * 60 * 1000 }); // 1 write per 5m per product
const searchMissThrottle = new LRUCache({ max: 1000, ttl: 30 * 60 * 1000 }); // 1 enqueue per 30m per term

export function parseSeedInputLines(rawInput, categoryHint = null, origin = "admin_seed", priority = 1) {
  const lines = Array.isArray(rawInput)
    ? rawInput
    : String(rawInput || "").split(/\r?\n/);

  const seen = new Set();
  const parsed = [];

  for (const rawLine of lines) {
    const trimmed = String(rawLine || "").trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 500) continue;

    const isUrl = /^https?:\/\//i.test(trimmed);
    if (isUrl) {
      if (!isSafePublicUrl(trimmed)) continue;
      const clean = canonicalizeUrl(trimmed);
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push({
        seedType: "url",
        queryOrUrl: clean,
        categoryHint,
        origin,
        priority,
      });
    } else {
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push({
        seedType: "keyword",
        queryOrUrl: trimmed,
        categoryHint,
        origin,
        priority,
      });
    }

    if (parsed.length >= 100) break;
  }

  return parsed;
}

export async function bulkEnqueuePoolSeedsService({ seedsInput, category = null }) {
  const entries = parseSeedInputLines(seedsInput, category, "admin_seed", 1);
  if (entries.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Không có từ khóa hoặc URL hợp lệ nào để thêm vào hàng đợi.",
    };
  }

  await insertDiscoverySeedsBatch(entries);
  return {
    ok: true,
    status: 201,
    queuedCount: entries.length,
    entries,
  };
}

export async function getPoolDashboardService() {
  return fetchPoolOverviewStats();
}

export async function removePoolQueueItemService({ id, purgeFinished = false }) {
  if (purgeFinished) {
    const purged = await purgeCompletedDiscoverySeeds();
    return { ok: true, status: 200, deletedCount: purged };
  }
  const deleted = await deleteDiscoverySeed(id);
  return { ok: true, status: 200, deletedCount: deleted };
}

/**
 * Demand-driven pool auto-expansion hook called when user search yields < 2 matches.
 */
export async function recordSearchMissForPoolExpansion(rawQuery) {
  const cleaned = String(rawQuery || "").trim();
  if (cleaned.length < 3 || cleaned.length > 120) return false;

  const key = cleaned.toLowerCase();
  if (searchMissThrottle.has(key)) return false;
  searchMissThrottle.set(key, true);

  try {
    await insertDiscoverySeedsBatch([
      {
        seedType: "keyword",
        queryOrUrl: cleaned,
        categoryHint: null,
        origin: "user_search",
        priority: 2,
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throttled product view tracker — promotes viewed products into the WARM refresh tier.
 */
export async function recordProductViewForWarmTier(productId) {
  const id = Number(productId);
  if (!Number.isInteger(id) || id <= 0) return false;
  if (viewThrottle.has(id)) return false;
  viewThrottle.set(id, true);

  try {
    await incrementProductViewCount(id);
    return true;
  } catch {
    return false;
  }
}

export function resetPoolThrottlesForTest() {
  viewThrottle.clear();
  searchMissThrottle.clear();
}
