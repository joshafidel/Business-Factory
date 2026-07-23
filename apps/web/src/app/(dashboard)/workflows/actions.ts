"use server";

import { revalidatePath } from "next/cache";
import { setWorkflowStatus, startWorkflowRun } from "@bf/workflows";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { dispatchAdvance } from "@/lib/execution";
import { checkRateLimit } from "@/lib/rate-limit";
import { PlatformError, toErrorRecord } from "@bf/shared";

const runInputSchema = z.record(z.unknown());

export async function runWorkflowAction(
  workflowKey: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await assertPermission("workflows:execute");
  if (!(await checkRateLimit(`run:${ctx.userId}`, 30, 60))) {
    return { error: "Rate limit exceeded — try again in a minute." };
  }
  let input: Record<string, unknown> = {};
  const raw = formData.get("input");
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      input = runInputSchema.parse(JSON.parse(raw));
    } catch {
      return { error: "Input must be a valid JSON object." };
    }
  }
  let runId: string;
  try {
    const run = await startWorkflowRun({
      organizationId: ctx.organizationId,
      workflowKey,
      input,
      triggeredBy: { kind: "user", id: ctx.userId },
      enqueueAdvance: dispatchAdvance,
    });
    runId = run.id;
  } catch (err) {
    if (err instanceof PlatformError) return { error: toErrorRecord(err).message };
    throw err;
  }
  redirect(`/runs/${runId}`);
}

export async function setWorkflowStatusAction(
  workflowId: string,
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
): Promise<void> {
  const ctx = await assertPermission("workflows:write");
  await setWorkflowStatus({
    organizationId: ctx.organizationId,
    workflowId,
    status,
    userId: ctx.userId,
  });
  revalidatePath("/workflows");
}
