import {
  prisma,
  writeAudit,
  type ApprovalActionType,
  type ApprovalRequest,
  type OrgRole,
  type Prisma,
  type RiskLevel,
} from "@bf/database";
import { notify } from "@bf/notifications";
import { PlatformError, type Role, roleAtLeast } from "@bf/shared";

/**
 * Approval system. Requests are created by workflow steps (or any governed
 * action); decisions come from humans in the Approval Inbox. Policies decide
 * whether a given action needs approval and who may decide.
 */

const RISK_RANK: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Evaluate configured policies. Returns the strictest matching requirement,
 * or null when no policy demands approval. Steps of type HUMAN_APPROVAL and
 * PUBLISH always require approval regardless of policies.
 */
export async function evaluateApprovalPolicies(params: {
  organizationId: string;
  moduleKey?: string | null;
  workflowKey?: string | null;
  stepKey?: string | null;
  actionType: ApprovalActionType;
  estimatedCostMicroUsd: bigint;
  riskLevel: RiskLevel;
}): Promise<{ required: boolean; requiredRole: OrgRole }> {
  const policies = await prisma.approvalPolicy.findMany({
    where: { organizationId: params.organizationId, isEnabled: true },
  });
  let required = false;
  let requiredRole: OrgRole = "REVIEWER";
  for (const policy of policies) {
    if (policy.moduleKey && policy.moduleKey !== params.moduleKey) continue;
    if (policy.workflowKey && policy.workflowKey !== params.workflowKey) continue;
    if (policy.stepKey && policy.stepKey !== params.stepKey) continue;
    if (policy.actionType && policy.actionType !== params.actionType) continue;
    if (
      policy.costThresholdMicroUsd != null &&
      params.estimatedCostMicroUsd < policy.costThresholdMicroUsd
    )
      continue;
    if (policy.minRiskLevel && RISK_RANK[params.riskLevel] < RISK_RANK[policy.minRiskLevel])
      continue;
    required = true;
    if (RISK_RANK_ROLE[policy.requiredRole] > RISK_RANK_ROLE[requiredRole]) {
      requiredRole = policy.requiredRole;
    }
  }
  return { required, requiredRole };
}

const RISK_RANK_ROLE: Record<OrgRole, number> = {
  VIEWER: 1,
  REVIEWER: 2,
  OPERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
};

export async function createApprovalRequest(params: {
  organizationId: string;
  workflowRunId?: string;
  stepRunId?: string;
  title: string;
  description: string;
  actionType: ApprovalActionType;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  estimatedCostMicroUsd?: bigint;
  requiredRole?: OrgRole;
}): Promise<ApprovalRequest> {
  const request = await prisma.approvalRequest.create({
    data: {
      organizationId: params.organizationId,
      workflowRunId: params.workflowRunId,
      stepRunId: params.stepRunId,
      title: params.title,
      description: params.description,
      actionType: params.actionType,
      riskLevel: params.riskLevel,
      payload: params.payload as Prisma.InputJsonValue,
      estimatedCostMicroUsd: params.estimatedCostMicroUsd ?? 0n,
      requiredRole: params.requiredRole ?? "REVIEWER",
    },
  });
  await notify({
    organizationId: params.organizationId,
    userId: null,
    kind: "APPROVAL_REQUIRED",
    title: `Approval required: ${params.title}`,
    body: params.description || "A workflow is waiting for review.",
    href: `/approvals/${request.id}`,
  });
  await writeAudit({
    organizationId: params.organizationId,
    actorType: "workflow",
    action: "approval.requested",
    entityType: "ApprovalRequest",
    entityId: request.id,
    detail: { actionType: params.actionType, riskLevel: params.riskLevel },
  });
  return request;
}

export type DecisionInput = {
  organizationId: string;
  approvalRequestId: string;
  userId: string;
  userRole: Role;
  decision: "APPROVED" | "REJECTED" | "REVISION_REQUESTED";
  comment?: string;
};

/**
 * Record a human decision. Enforces the request's required role, one-pending-
 * decision semantics, and returns the updated request. Resuming the parked
 * workflow run is the caller's job (web enqueues, engine picks it up).
 */
export async function decideApproval(input: DecisionInput): Promise<ApprovalRequest> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: input.approvalRequestId, organizationId: input.organizationId },
  });
  if (!request) throw new PlatformError("NOT_FOUND", "Approval request not found");
  if (request.status !== "PENDING") {
    throw new PlatformError("CONFLICT", `Approval request is already ${request.status}`);
  }
  if (!roleAtLeast(input.userRole, request.requiredRole as Role)) {
    throw new PlatformError(
      "PERMISSION_DENIED",
      `Deciding this request requires the ${request.requiredRole} role`,
    );
  }

  const statusMap = {
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    REVISION_REQUESTED: "REVISION_REQUESTED",
  } as const;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.approvalDecision.create({
      data: {
        approvalRequestId: request.id,
        userId: input.userId,
        decision: input.decision,
        comment: input.comment,
      },
    });
    const u = await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: statusMap[input.decision] },
    });
    await writeAudit(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        actorType: "user",
        action: `approval.${input.decision.toLowerCase()}`,
        entityType: "ApprovalRequest",
        entityId: request.id,
        detail: { comment: input.comment ?? null },
      },
      tx,
    );
    return u;
  });
  return updated;
}
