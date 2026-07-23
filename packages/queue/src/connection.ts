import { loadEnv } from "@bf/config";
import IORedis, { type Redis } from "ioredis";

let cached: Redis | null = null;

/**
 * Shared Redis connection for producers (web) and health checks. Configured
 * to FAIL FAST when Redis is absent (serverless deployments running in
 * inline mode): no offline command queue, short connect timeout, capped
 * reconnect attempts. BullMQ requires maxRetriesPerRequest=null.
 */
export function getRedis(): Redis {
  // Recreate the connection if a previous one gave up (retryStrategy null).
  if (cached && cached.status !== "end") return cached;
  const env = loadEnv();
  cached = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 3_000,
    // Give up after ~7s when Redis is absent; commands queued meanwhile
    // reject at that point instead of hanging forever.
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 3_000)),
  });
  // Without a listener, an unreachable Redis crashes the process.
  cached.on("error", () => undefined);
  return cached;
}

/** Dedicated blocking connection for BullMQ Workers (worker process only). */
export function createRedis(): Redis {
  const env = loadEnv();
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

/**
 * Execution mode: explicit EXECUTION_MODE wins; otherwise "queue" when a
 * REDIS_URL is actually configured in the environment, else "inline".
 * (Raw process.env is checked because loadEnv applies a localhost default.)
 */
export function getExecutionMode(): "queue" | "inline" {
  const explicit = process.env.EXECUTION_MODE;
  if (explicit === "inline" || explicit === "queue") return explicit;
  return process.env.REDIS_URL ? "queue" : "inline";
}
