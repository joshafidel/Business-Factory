import { can } from "@bf/shared";
import { PlatformError, toErrorRecord } from "@bf/shared";
import { applyApprovalDecision, decideApproval } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAdvance } from "@/lib/execution";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 300;

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "REVISION_REQUESTED"]),
  comment: z.string().max(2000).optional(),
});

/** API equivalent of the Approval Inbox decision buttons. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "approvals:decide")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    await decideApproval({
      organizationId: ctx.organizationId,
      approvalRequestId: id,
      userId: ctx.userId,
      userRole: ctx.role,
      decision: parsed.data.decision,
      comment: parsed.data.comment,
    });
    await applyApprovalDecision({ approvalRequestId: id, enqueueAdvance: dispatchAdvance });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PlatformError) {
      const rec = toErrorRecord(err);
      return NextResponse.json(
        { error: rec.message, code: rec.code },
        { status: rec.code === "PERMISSION_DENIED" ? 403 : rec.code === "NOT_FOUND" ? 404 : 409 },
      );
    }
    throw err;
  }
}
