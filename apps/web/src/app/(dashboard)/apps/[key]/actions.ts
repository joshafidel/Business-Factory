"use server";

import { PlatformError, toErrorRecord } from "@bf/shared";
import { startWorkflowRun } from "@bf/workflows";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/session";
import { dispatchAdvance } from "@/lib/execution";
import { checkRateLimit } from "@/lib/rate-limit";

export async function createVideoAction(
  workflowKey: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await assertPermission("workflows:execute");
  if (!(await checkRateLimit(`video:${ctx.userId}`, 10, 60))) {
    return { error: "Slow down a little — try again in a minute." };
  }
  const animal = ((formData.get("animal") as string) || "").trim();
  try {
    await startWorkflowRun({
      organizationId: ctx.organizationId,
      workflowKey,
      input: animal ? { animal } : {},
      triggeredBy: { kind: "user", id: ctx.userId },
      enqueueAdvance: dispatchAdvance,
    });
  } catch (err) {
    if (err instanceof PlatformError) return { error: toErrorRecord(err).message };
    throw err;
  }
  revalidatePath(`/apps/kids-shorts`);
  return {};
}
