"use server";

import { revalidatePath } from "next/cache";
import { cancelWorkflowRun } from "@bf/workflows";
import { assertPermission } from "@/lib/session";

export async function cancelRunAction(workflowRunId: string): Promise<void> {
  const ctx = await assertPermission("workflows:execute");
  await cancelWorkflowRun({
    organizationId: ctx.organizationId,
    workflowRunId,
    userId: ctx.userId,
  });
  revalidatePath(`/runs/${workflowRunId}`);
}
