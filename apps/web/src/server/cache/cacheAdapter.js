import "server-only";
import { LRUCache } from "lru-cache";

const memoryCache = new LRUCache({
  max: 1000,
  ttl: 60 * 1000,
  allowStale: false,
});

let redisClient = null;
let redisDisabled = false;

function getRedisClient() {
  if (redisDisabled || !process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  try {
    const Redis = require("ioredis");
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on("error", () => {});
    return redisClient;
  } catch {
    redisDisabled = true;
    return null;
  }
}

export async function cacheGet(key) {
  const localVal = memoryCache.get(key);
  if (localVal !== undefined) return localVal;

  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        memoryCache.set(key, parsed);
        return parsed;
      }
    } catch {}
  }
  return null;
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  const ttlMs = Math.max(1, ttlSeconds) * 1000;
  memoryCache.set(key, value, { ttl: ttlMs });

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
    } catch {}
  }
}

export async function cacheInvalidatePrefix(prefix) {
  for (const key of memoryCache.keys()) {
    if (String(key).startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(...keys);
    } catch {}
  }
}

export async function remember(key, ttlSeconds, fetcher) {
  // Fast synchronous check for L1 memory cache hit (avoids extra microtask ticks)
  const l1 = memoryCache.get(key);
  if (l1 !== undefined) return l1;

  const redis = getRedisClient();
  if (redis) {
    const l2 = await cacheGet(key);
    if (l2 !== null) return l2;
  }

  const fresh = await fetcher();
  if (fresh !== undefined && fresh !== null) {
    await cacheSet(key, fresh, ttlSeconds);
  }
  return fresh;
}

export function clearAllMemoryCache() {
  memoryCache.clear();
}
