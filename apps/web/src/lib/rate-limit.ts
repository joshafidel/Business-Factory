import { createLogger } from "@bf/shared";

const log = createLogger("rate-limit");

/**
 * Sliding-window rate limiter backed by Redis when available, falling back to
 * an in-process map (fine for a single web instance; Redis covers multi-node).
 */
const memory = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { getRedis } = await import("@bf/queue");
    const redis = getRedis();
    const redisKey = `bf:rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds);
    return count <= maxRequests;
  } catch (err) {
    log.debug({ err }, "redis unavailable for rate limit; using memory");
    const now = Date.now();
    const entry = memory.get(key);
    if (!entry || entry.resetAt < now) {
      memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= maxRequests;
  }
}
