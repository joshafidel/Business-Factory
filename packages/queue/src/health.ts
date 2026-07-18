import { getRedis } from "./connection";

const HEARTBEAT_KEY = "bf:worker:heartbeat";
const STALE_AFTER_MS = 30_000;

/** Worker heartbeat: written every 10s by each worker process. */
export async function beatWorkerHeartbeat(workerId: string): Promise<void> {
  const redis = getRedis();
  await redis.hset(HEARTBEAT_KEY, workerId, Date.now().toString());
}

export interface WorkerHealth {
  workerId: string;
  lastBeatAt: Date;
  healthy: boolean;
}

export async function getWorkerHealth(): Promise<WorkerHealth[]> {
  const redis = getRedis();
  const entries = await redis.hgetall(HEARTBEAT_KEY);
  const now = Date.now();
  const out: WorkerHealth[] = [];
  for (const [workerId, ts] of Object.entries(entries)) {
    const t = Number(ts);
    // Drop entries dead for over an hour to keep the hash tidy.
    if (now - t > 3_600_000) {
      await redis.hdel(HEARTBEAT_KEY, workerId);
      continue;
    }
    out.push({ workerId, lastBeatAt: new Date(t), healthy: now - t < STALE_AFTER_MS });
  }
  return out.sort((a, b) => b.lastBeatAt.getTime() - a.lastBeatAt.getTime());
}

export async function redisHealthy(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === "PONG";
  } catch {
    return false;
  }
}
