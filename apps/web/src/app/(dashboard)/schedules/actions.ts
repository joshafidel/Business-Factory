"use server";

import { revalidatePath } from "next/cache";
import { prisma, writeAudit } from "@bf/database";
import { JOB_NAMES, QUEUES, computeNextRun, enqueue } from "@bf/queue";
import { PlatformError } from "@bf/shared";
import { z } from "zod";
import { assertPermission } from "@/lib/session";

export async function toggleScheduleAction(scheduleId: string): Promise<void> {
  const ctx = await assertPermission("schedules:manage");
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, organizationId: ctx.organizationId },
  });
  if (!schedule) throw new PlatformError("NOT_FOUND", "Schedule not found");
  const next = schedule.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await prisma.schedule.update({
    where: { id: schedule.id },
    data: {
      status: next,
      nextRunAt:
        next === "ACTIVE" && schedule.cron
          ? computeNextRun(schedule.cron, schedule.timezone)
          : next === "PAUSED"
            ? null
            : schedule.nextRunAt,
    },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: next === "PAUSED" ? "schedule.paused" : "schedule.resumed",
    entityType: "Schedule",
    entityId: schedule.id,
  });
  revalidatePath("/schedules");
}

export async function runScheduleNowAction(scheduleId: string): Promise<void> {
  const ctx = await assertPermission("schedules:manage");
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, organizationId: ctx.organizationId },
  });
  if (!schedule) throw new PlatformError("NOT_FOUND", "Schedule not found");
  await enqueue(
    QUEUES.workflow,
    JOB_NAMES.scheduleFire,
    { scheduleId: schedule.id, organizationId: ctx.organizationId },
    { organizationId: ctx.organizationId },
  );
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "schedule.manual_run",
    entityType: "Schedule",
    entityId: schedule.id,
  });
  revalidatePath("/schedules");
}

const createScheduleSchema = z.object({
  workflowId: z.string().min(1),
  name: z.string().min(1).max(120),
  cron: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64),
});

export async function createScheduleAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("schedules:manage");
  const parsed = createScheduleSchema.safeParse({
    workflowId: formData.get("workflowId"),
    name: formData.get("name"),
    cron: formData.get("cron"),
    timezone: formData.get("timezone") || "UTC",
  });
  if (!parsed.success) return { error: "All fields are required." };
  const { workflowId, name, cron, timezone } = parsed.data;

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, organizationId: ctx.organizationId },
  });
  if (!workflow) return { error: "Workflow not found." };
  const next = computeNextRun(cron, timezone);
  if (!next) return { error: "Invalid cron expression or timezone." };

  const schedule = await prisma.schedule.create({
    data: {
      organizationId: ctx.organizationId,
      workflowId,
      name,
      cron,
      timezone,
      nextRunAt: next,
    },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "schedule.created",
    entityType: "Schedule",
    entityId: schedule.id,
    detail: { cron, timezone },
  });
  revalidatePath("/schedules");
  return {};
}
