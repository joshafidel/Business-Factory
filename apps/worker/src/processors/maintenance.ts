import { prisma } from "@bf/database";
import { createLogger } from "@bf/shared";
import { type Job, type Processor } from "bullmq";

const log = createLogger("worker:maintenance");

/** Housekeeping jobs: stale-run detection and old-notification cleanup. */
export function createMaintenanceProcessor(): Processor {
  return async (job: Job) => {
    switch (job.name) {
      case "sweep.stale-runs": {
        // Runs stuck RUNNING for over 2h with no live step get failed.
        const cutoff = new Date(Date.now() - 2 * 3600_000);
        const stale = await prisma.workflowRun.updateMany({
          where: { status: "RUNNING", updatedAt: { lt: cutoff } },
          data: {
            status: "FAILED",
            error: { code: "INTERNAL", message: "Marked stale by maintenance sweep" },
            finishedAt: new Date(),
          },
        });
        if (stale.count > 0) log.warn({ count: stale.count }, "failed stale runs");
        return { staleRuns: stale.count };
      }
      case "cleanup.notifications": {
        const cutoff = new Date(Date.now() - 90 * 86_400_000);
        const deleted = await prisma.notification.deleteMany({
          where: { isRead: true, createdAt: { lt: cutoff } },
        });
        return { deleted: deleted.count };
      }
      default:
        log.warn({ name: job.name }, "unknown maintenance job");
        return null;
    }
  };
}
