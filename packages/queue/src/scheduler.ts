import { prisma } from "@bf/database";
import { createLogger } from "@bf/shared";
import parser from "cron-parser";
import { getQueue, QUEUES } from "./queues";

const log = createLogger("scheduler");

/**
 * Schedules live in the DB (source of truth) and are materialized as BullMQ
 * repeatable jobs. The worker calls reconcileSchedules() on boot and whenever
 * a schedule changes, so Redis state always converges to the DB.
 */

const SCHEDULE_JOB = "schedule.fire";

export function computeNextRun(cron: string, timezone: string, from = new Date()): Date | null {
  try {
    const interval = parser.parseExpression(cron, { currentDate: from, tz: timezone });
    return interval.next().toDate();
  } catch (err) {
    log.warn({ cron, timezone, err }, "invalid cron expression");
    return null;
  }
}

export async function reconcileSchedules(): Promise<void> {
  const queue = getQueue(QUEUES.workflow);
  const schedules = await prisma.schedule.findMany({
    include: { workflow: { select: { status: true } } },
  });

  // Remove repeatables that no longer correspond to an active schedule.
  const repeatables = await queue.getJobSchedulers();
  const wantedIds = new Set(
    schedules
      .filter((s) => s.status === "ACTIVE" && s.cron && s.workflow.status === "ACTIVE")
      .map((s) => `schedule:${s.id}`),
  );
  for (const rep of repeatables) {
    if (rep.id?.startsWith("schedule:") && !wantedIds.has(rep.id)) {
      await queue.removeJobScheduler(rep.id);
      log.info({ schedulerId: rep.id }, "removed stale repeatable");
    }
  }

  for (const schedule of schedules) {
    const schedulerId = `schedule:${schedule.id}`;
    const active = schedule.status === "ACTIVE" && schedule.workflow.status === "ACTIVE";

    if (schedule.cron && active) {
      await queue.upsertJobScheduler(
        schedulerId,
        { pattern: schedule.cron, tz: schedule.timezone },
        {
          name: SCHEDULE_JOB,
          data: { scheduleId: schedule.id },
        },
      );
      const next = computeNextRun(schedule.cron, schedule.timezone);
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: next },
      });
    } else if (schedule.runAt && active && schedule.runAt > new Date()) {
      // One-shot: a delayed job with an idempotent id.
      const existing = await queue.getJob(schedulerId);
      if (!existing) {
        await queue.add(
          SCHEDULE_JOB,
          { scheduleId: schedule.id },
          { jobId: schedulerId, delay: schedule.runAt.getTime() - Date.now() },
        );
      }
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: schedule.runAt },
      });
    }
  }
  log.info({ count: schedules.length }, "schedules reconciled");
}

export { SCHEDULE_JOB };
