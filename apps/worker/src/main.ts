import http from "node:http";
import os from "node:os";
import { loadEnv } from "@bf/config";
import { prisma } from "@bf/database";
import {
  QUEUES,
  beatWorkerHeartbeat,
  createRedis,
  reconcileSchedules,
  redisHealthy,
} from "@bf/queue";
import { createLogger } from "@bf/shared";
import { Worker } from "bullmq";
import { createWorkflowProcessor } from "./processors/workflow";
import { createMaintenanceProcessor } from "./processors/maintenance";

const log = createLogger("worker");

/**
 * Standalone worker process. Runs independently of the web server:
 *   pnpm --filter @bf/worker start
 * Multiple instances can run side by side; BullMQ distributes jobs.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const workerId = `${os.hostname()}:${process.pid}`;
  log.info({ workerId, concurrency: env.WORKER_CONCURRENCY }, "worker starting");

  // Fail fast when infrastructure is missing.
  await prisma.$queryRaw`SELECT 1`;
  if (!(await redisHealthy())) throw new Error("Redis is not reachable");

  const workflowWorker = new Worker(QUEUES.workflow, createWorkflowProcessor(), {
    connection: createRedis(),
    concurrency: env.WORKER_CONCURRENCY,
    limiter: { max: 50, duration: 1_000 },
  });
  const maintenanceWorker = new Worker(QUEUES.maintenance, createMaintenanceProcessor(), {
    connection: createRedis(),
    concurrency: 2,
  });

  for (const w of [workflowWorker, maintenanceWorker]) {
    w.on("failed", (job, err) => {
      log.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed");
    });
    w.on("error", (err) => log.error({ queue: w.name, err: err.message }, "worker error"));
  }

  // Schedules: DB is the source of truth; reconcile now and every 5 minutes.
  await reconcileSchedules();
  const reconcileTimer = setInterval(() => {
    reconcileSchedules().catch((err) => log.error({ err }, "schedule reconciliation failed"));
  }, 5 * 60_000);

  // Heartbeat for dashboard worker-health display.
  await beatWorkerHeartbeat(workerId);
  const heartbeatTimer = setInterval(() => {
    beatWorkerHeartbeat(workerId).catch(() => undefined);
  }, 10_000);

  // Health endpoint (used by container orchestrators and the dashboard).
  const server = http.createServer(async (_req, res) => {
    const healthy = await redisHealthy();
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: healthy, workerId, uptimeSeconds: process.uptime() }));
  });
  server.listen(env.WORKER_HEALTH_PORT, () => {
    log.info({ port: env.WORKER_HEALTH_PORT }, "health endpoint listening");
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    clearInterval(reconcileTimer);
    clearInterval(heartbeatTimer);
    server.close();
    await Promise.allSettled([workflowWorker.close(), maintenanceWorker.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log.info("worker ready");
}

main().catch((err) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});
