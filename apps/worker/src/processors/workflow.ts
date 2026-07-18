import { runAgent } from "@bf/agents";
import { prisma } from "@bf/database";
import { JOB_NAMES, deadLetter, enqueueWorkflowAdvance, updateJobRecord } from "@bf/queue";
import { createLogger, toErrorRecord } from "@bf/shared";
import { advanceWorkflowRun, startWorkflowRun } from "@bf/workflows";
import { type Job, type Processor } from "bullmq";

const log = createLogger("worker:workflow");

interface BaseJobData {
  _jobRecordId?: string;
  organizationId?: string;
}

/**
 * Processor for the workflow queue: run advancement, schedule firing, and
 * standalone agent runs. Each handler is idempotent — advancing an already-
 * finished run is a no-op, and schedule fires carry idempotency keys.
 */
export function createWorkflowProcessor(): Processor {
  return async (job: Job) => {
    const data = job.data as BaseJobData & Record<string, unknown>;
    await updateJobRecord(data._jobRecordId, {
      status: "ACTIVE",
      startedAt: new Date(),
      attempts: job.attemptsMade + 1,
    });
    try {
      let result: unknown = null;
      switch (job.name) {
        case JOB_NAMES.workflowAdvance:
          await advanceWorkflowRun(data.workflowRunId as string, enqueueWorkflowAdvance);
          break;
        case JOB_NAMES.scheduleFire:
          result = await fireSchedule(data.scheduleId as string);
          break;
        case JOB_NAMES.agentRun: {
          const res = await runAgent({
            organizationId: data.organizationId as string,
            agentKey: data.agentKey as string,
            goal: data.goal as string,
            input: data.input as Record<string, unknown>,
          });
          result = { agentRunId: res.run.id };
          break;
        }
        default:
          log.warn({ name: job.name }, "unknown job name");
      }
      await updateJobRecord(data._jobRecordId, {
        status: "COMPLETED",
        result: result as never,
        finishedAt: new Date(),
      });
      return result;
    } catch (err) {
      const record = toErrorRecord(err);
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) {
        await deadLetter({
          jobRecordId: data._jobRecordId,
          organizationId: data.organizationId,
          queueName: job.queueName,
          jobName: job.name,
          error: record as unknown as Record<string, unknown>,
        });
      } else {
        await updateJobRecord(data._jobRecordId, {
          status: "FAILED",
          error: record as never,
        });
      }
      throw err;
    }
  };
}

/** Fire a schedule: start its workflow with the stored input. */
async function fireSchedule(scheduleId: string): Promise<unknown> {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: { workflow: true },
  });
  if (!schedule || schedule.status !== "ACTIVE") return { skipped: true };
  if (schedule.workflow.status !== "ACTIVE") return { skipped: true, reason: "workflow inactive" };

  const run = await startWorkflowRun({
    organizationId: schedule.organizationId,
    workflowKey: schedule.workflow.key,
    input: (schedule.input as Record<string, unknown>) ?? {},
    triggeredBy: { kind: "schedule", id: schedule.id },
    // One run per schedule per minute — a duplicate fire dedupes.
    idempotencyKey: `schedule:${schedule.id}:${new Date().toISOString().slice(0, 16)}`,
    enqueueAdvance: enqueueWorkflowAdvance,
  });
  await prisma.schedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: new Date(),
      ...(schedule.runAt ? { status: "COMPLETED", nextRunAt: null } : {}),
    },
  });
  return { workflowRunId: run.id };
}
