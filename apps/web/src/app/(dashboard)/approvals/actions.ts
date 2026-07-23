"use server";

import { revalidatePath } from "next/cache";
import { PlatformError, toErrorRecord } from "@bf/shared";
import { applyApprovalDecision, decideApproval } from "@bf/workflows";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { dispatchAdvance } from "@/lib/execution";

const decisionSchema = z.object({
  approvalRequestId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED", "REVISION_REQUESTED"]),
  comment: z.string().max(2000).optional(),
});

export async function decideApprovalAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("approvals:decide");
  const parsed = decisionSchema.safeParse({
    approvalRequestId: formData.get("approvalRequestId"),
    decision: formData.get("decision"),
    comment: (formData.get("comment") as string) || undefined,
  });
  if (!parsed.success) return { error: "Invalid decision payload" };

  try {
    await decideApproval({
      organizationId: ctx.organizationId,
      approvalRequestId: parsed.data.approvalRequestId,
      userId: ctx.userId,
      userRole: ctx.role,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
    });
    // Resume/cancel/revise the parked workflow run.
    await applyApprovalDecision({
      approvalRequestId: parsed.data.approvalRequestId,
      enqueueAdvance: dispatchAdvance,
    });
  } catch (err) {
    if (err instanceof PlatformError) return { error: toErrorRecord(err).message };
    throw err;
  }
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${parsed.data.approvalRequestId}`);
  return {};
}
