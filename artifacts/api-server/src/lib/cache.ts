/**
 * Redis cache client (ioredis).
 * Gracefully no-ops if REDIS_URL is not set (dev / no Redis).
 *
 * Usage:
 *   import { cacheGet, cacheSet, cacheDel, cacheDelPattern } from "./cache.js";
 *
 *   const cached = await cacheGet("key");
 *   if (cached) return res.json(JSON.parse(cached));
 *   // ... compute result ...
 *   await cacheSet("key", JSON.stringify(result), 30); // 30 second TTL
 */

import Redis from "ioredis";

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (_redis) return _redis;
  _redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  _redis.on("error", (err) => {
    // Log but don't crash — cache failures are non-fatal
    console.warn("[cache] Redis error:", err.message);
  });
  return _redis;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await getRedis()?.get(key) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedis()?.set(key, value, "EX", ttlSeconds);
  } catch { /* non-fatal */ }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length) await getRedis()?.del(...keys);
  } catch { /* non-fatal */ }
}

/** Delete all keys matching a glob pattern e.g. "photos:user123:*" */
export async function cacheDelPattern(pattern: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch { /* non-fatal */ }
}
