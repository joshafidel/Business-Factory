import { prisma, type Prisma } from "@bf/database";
import { createLogger } from "@bf/shared";
import { Queue, type JobsOptions } from "bullmq";
import { getRedis } from "./connection";

const log = createLogger("queue");

/** Queue names. One queue per concern; workers set their own concurrency. */
export const QUEUES = {
  workflow: "workflow",
  agent: "agent",
  maintenance: "maintenance",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job payloads, discriminated by job name. */
export interface WorkflowStepJobData {
  organizationId: string;
  workflowRunId: string;
}

export interface AgentJobData {
  organizationId: string;
  agentKey: string;
  goal: string;
  input: Record<string, unknown>;
}

export interface ScheduleFireJobData {
  scheduleId: string;
}

const queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: false,
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export interface EnqueueOptions extends JobsOptions {
  organizationId?: string;
  /** Dedupe key: a second enqueue with the same key on the same queue is a no-op. */
  idempotencyKey?: string;
}

/**
 * Enqueue a job and mirror it into the Job table for dashboard visibility.
 * Returns null when an idempotency key dedupes the enqueue.
 */
export async function enqueue<T extends Record<string, unknown>>(
  queueName: QueueName,
  jobName: string,
  data: T,
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const { organizationId, idempotencyKey, ...jobOptions } = opts;

  if (idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: { queue_idempotencyKey: { queue: queueName, idempotencyKey } },
    });
    if (existing) {
      log.info({ queueName, jobName, idempotencyKey }, "enqueue deduped");
      return null;
    }
  }

  const record = await prisma.job.create({
    data: {
      organizationId,
      queue: queueName,
      name: jobName,
      status: jobOptions.delay ? "DELAYED" : "WAITING",
      payload: data as Prisma.InputJsonValue,
      maxAttempts: (jobOptions.attempts as number | undefined) ?? 3,
      priority: (jobOptions.priority as number | undefined) ?? 0,
      idempotencyKey,
      scheduledFor: jobOptions.delay ? new Date(Date.now() + Number(jobOptions.delay)) : null,
    },
  });

  const job = await getQueue(queueName).add(
    jobName,
    { ...data, _jobRecordId: record.id },
    jobOptions,
  );
  await prisma.job.update({ where: { id: record.id }, data: { externalId: job.id } });
  return record.id;
}

/** Update the Job mirror row as the queue processes it. Never throws. */
export async function updateJobRecord(
  jobRecordId: string | undefined,
  data: Prisma.JobUpdateInput,
): Promise<void> {
  if (!jobRecordId) return;
  try {
    await prisma.job.update({ where: { id: jobRecordId }, data });
  } catch (err) {
    log.warn({ jobRecordId, err }, "failed to update job record");
  }
}

/**
 * Dead-letter: called when a job exhausts its attempts. Records the terminal
 * state and notifies admins. The failed BullMQ job is kept for inspection.
 */
export async function deadLetter(params: {
  jobRecordId?: string;
  organizationId?: string;
  queueName: string;
  jobName: string;
  error: Record<string, unknown>;
}): Promise<void> {
  await updateJobRecord(params.jobRecordId, {
    status: "DEAD",
    error: params.error as Prisma.InputJsonValue,
    finishedAt: new Date(),
  });
  if (params.organizationId) {
    const { notify } = await import("@bf/notifications");
    await notify({
      organizationId: params.organizationId,
      userId: null,
      kind: "JOB_FAILURE",
      title: `Job dead-lettered: ${params.jobName}`,
      body: `Queue "${params.queueName}" job "${params.jobName}" exhausted all retries.`,
      href: "/jobs",
    });
  }
}

/** Cancel a queued/delayed job by its Job record id. */
export async function cancelJob(jobRecordId: string): Promise<boolean> {
  const record = await prisma.job.findUnique({ where: { id: jobRecordId } });
  if (!record || !record.externalId) return false;
  const queue = getQueue(record.queue as QueueName);
  const job = await queue.getJob(record.externalId);
  if (job) {
    const state = await job.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized") {
      await job.remove();
      await updateJobRecord(jobRecordId, { status: "CANCELLED", finishedAt: new Date() });
      return true;
    }
  }
  return false;
}

/** Aggregate queue counts for the dashboard. */
export async function queueCounts(): Promise<
  Record<
    string,
    { waiting: number; active: number; delayed: number; failed: number; completed: number }
  >
> {
  const out: Record<
    string,
    { waiting: number; active: number; delayed: number; failed: number; completed: number }
  > = {};
  for (const name of Object.values(QUEUES)) {
    try {
      const counts = await getQueue(name).getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed",
      );
      out[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      };
    } catch {
      out[name] = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    }
  }
  return out;
}

/** Job names used by the workflow queue. */
export const JOB_NAMES = {
  workflowAdvance: "workflow.advance",
  scheduleFire: "schedule.fire",
  agentRun: "agent.run",
} as const;

/**
 * Enqueue a workflow-run advance. Matches the engine's EnqueueAdvance
 * signature so web and worker share one implementation.
 */
export async function enqueueWorkflowAdvance(
  workflowRunId: string,
  organizationId: string,
  opts?: { delayMs?: number },
): Promise<void> {
  await enqueue(
    QUEUES.workflow,
    JOB_NAMES.workflowAdvance,
    { organizationId, workflowRunId },
    { organizationId, delay: opts?.delayMs },
  );
}

/** Remove finished jobs from all queues (used by pnpm queue:clean). */
export async function cleanQueues(): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    const queue = getQueue(name);
    await queue.clean(0, 10_000, "completed");
    await queue.clean(0, 10_000, "failed");
  }
}
