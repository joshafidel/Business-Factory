import { loadEnv } from "@bf/config";
import IORedis, { type Redis } from "ioredis";

let cached: Redis | null = null;

/** Shared Redis connection factory. BullMQ requires maxRetriesPerRequest=null. */
export function getRedis(): Redis {
  if (cached) return cached;
  const env = loadEnv();
  cached = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return cached;
}

export function createRedis(): Redis {
  const env = loadEnv();
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
