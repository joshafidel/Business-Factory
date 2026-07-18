import { prisma } from "@bf/database";
import { usdToMicro } from "@bf/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertWorkflowFromDefinition } from "../service";
import {
  advanceWorkflowRun,
  applyApprovalDecision,
  cancelWorkflowRun,
  startWorkflowRun,
  type EnqueueAdvance,
} from "../engine";
import { decideApproval } from "../approvals";
import { readPath } from "../definitions";
import { cleanupTestOrg, createEchoAgent, createTestOrg, dbAvailable } from "./fixtures";

const available = await dbAvailable();
let orgId: string;
let userId: string;

/**
 * Synchronous "queue": advancing is driven inline so these tests need no
 * Redis. Delayed re-enqueues are executed immediately, which is fine — the
 * engine's own state machine decides what actually runs.
 */
function makeInlineQueue(): { enqueue: EnqueueAdvance; drain: () => Promise<void> } {
  const pending: string[] = [];
  const enqueue: EnqueueAdvance = async (runId) => {
    pending.push(runId);
  };
  const drain = async (): Promise<void> => {
    let guard = 0;
    while (pending.length > 0 && guard++ < 50) {
      const runId = pending.shift();
      if (runId) await advanceWorkflowRun(runId, enqueue);
    }
  };
  return { enqueue, drain };
}

/** The sample pipeline shape: agent → approval → file generation. */
const SAMPLE_DEFINITION = {
  key: "test-pipeline",
  name: "Test Pipeline",
  description: "research → approval → save",
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", minLength: 3 } },
    required: ["topic"],
  },
  steps: [
    {
      key: "research",
      name: "Research",
      type: "AGENT_TASK" as const,
      config: {
        agentKey: "echo-agent",
        goal: "Produce a research brief",
        inputMapping: { topic: "$.input.topic" },
      },
      retryLimit: 2,
      timeoutMs: 60_000,
    },
    {
      key: "approval",
      name: "Human review",
      type: "HUMAN_APPROVAL" as const,
      config: {
        title: "Review the brief",
        description: "Check the research output",
        actionType: "REVIEW_OUTPUT",
        riskLevel: "LOW",
        payloadPaths: ["$.steps.research"],
      },
      retryLimit: 0,
      timeoutMs: 60_000,
    },
    {
      key: "save",
      name: "Save asset",
      type: "FILE_GENERATION" as const,
      config: {
        assetName: "Test brief",
        assetType: "JSON",
        mimeType: "application/json",
        contentPath: "$.steps.research",
      },
      retryLimit: 1,
      timeoutMs: 60_000,
    },
  ],
};

beforeAll(async () => {
  if (!available) return;
  process.env.STORAGE_LOCAL_ROOT = ".data/test-storage";
  const ctx = await createTestOrg();
  orgId = ctx.orgId;
  userId = ctx.userId;
  await createEchoAgent(orgId);
  await upsertWorkflowFromDefinition({
    organizationId: orgId,
    definition: SAMPLE_DEFINITION,
    activate: true,
  });
});

afterAll(async () => {
  if (available && orgId) await cleanupTestOrg(orgId);
});

describe.skipIf(!available)("workflow engine (integration)", () => {
  it("validates input against the workflow schema", async () => {
    const q = makeInlineQueue();
    await expect(
      startWorkflowRun({
        organizationId: orgId,
        workflowKey: "test-pipeline",
        input: { topic: 42 },
        triggeredBy: { kind: "user", id: userId },
        enqueueAdvance: q.enqueue,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("runs to the approval gate, then completes after approval (sample flow e2e)", async () => {
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "urban beekeeping" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();

    // Parked at the human approval gate.
    let state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("AWAITING_APPROVAL");
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, status: "PENDING" },
    });
    expect(request.title).toBe("Review the brief");
    // Approval notification fanned out.
    const note = await prisma.notification.findFirst({
      where: { organizationId: orgId, kind: "APPROVAL_REQUIRED" },
    });
    expect(note).not.toBeNull();

    // Approve as OWNER and resume.
    await decideApproval({
      organizationId: orgId,
      approvalRequestId: request.id,
      userId,
      userRole: "OWNER",
      decision: "APPROVED",
      comment: "Looks good",
    });
    await applyApprovalDecision({ approvalRequestId: request.id, enqueueAdvance: q.enqueue });
    await q.drain();

    state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("COMPLETED");

    // The approved output was saved as a real asset with bytes in storage.
    const asset = await prisma.asset.findFirstOrThrow({ where: { workflowRunId: run.id } });
    expect(asset.type).toBe("JSON");
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.approvalStatus).toBe("APPROVED");

    // Step history is complete.
    const stepRuns = await prisma.stepRun.findMany({ where: { workflowRunId: run.id } });
    expect(stepRuns.filter((s) => s.status === "COMPLETED").length).toBeGreaterThanOrEqual(3);
  });

  it("cancels the run when the approval is rejected", async () => {
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "rejected topic" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, status: "PENDING" },
    });
    await decideApproval({
      organizationId: orgId,
      approvalRequestId: request.id,
      userId,
      userRole: "OWNER",
      decision: "REJECTED",
      comment: "Not good enough",
    });
    await applyApprovalDecision({ approvalRequestId: request.id, enqueueAdvance: q.enqueue });
    await q.drain();
    const state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("CANCELLED");
    // No asset was created for a rejected run.
    expect(await prisma.asset.count({ where: { workflowRunId: run.id } })).toBe(0);
  });

  it("re-runs the producing step on revision request and re-gates", async () => {
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "revision topic" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();
    const first = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, status: "PENDING" },
    });
    await decideApproval({
      organizationId: orgId,
      approvalRequestId: first.id,
      userId,
      userRole: "OWNER",
      decision: "REVISION_REQUESTED",
      comment: "Add more detail",
    });
    await applyApprovalDecision({ approvalRequestId: first.id, enqueueAdvance: q.enqueue });
    await q.drain();

    // A fresh approval request exists; the run is parked again.
    const state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("AWAITING_APPROVAL");
    const requests = await prisma.approvalRequest.findMany({
      where: { workflowRunId: run.id },
      orderBy: { createdAt: "asc" },
    });
    expect(requests.length).toBe(2);
    expect(requests[1]?.status).toBe("PENDING");
    // The research step ran twice.
    const researchRuns = await prisma.stepRun.count({
      where: { workflowRunId: run.id, stepKey: "research", status: { not: "SKIPPED" } },
    });
    expect(researchRuns).toBeGreaterThanOrEqual(2);
  });

  it("enforces reviewer role requirements on decisions", async () => {
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "role check topic" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, status: "PENDING" },
    });
    await expect(
      decideApproval({
        organizationId: orgId,
        approvalRequestId: request.id,
        userId,
        userRole: "VIEWER",
        decision: "APPROVED",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Double-decide protection.
    await decideApproval({
      organizationId: orgId,
      approvalRequestId: request.id,
      userId,
      userRole: "REVIEWER",
      decision: "APPROVED",
    });
    await expect(
      decideApproval({
        organizationId: orgId,
        approvalRequestId: request.id,
        userId,
        userRole: "OWNER",
        decision: "REJECTED",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("stops execution when the org hard cost limit is reached", async () => {
    await prisma.costLimit.create({
      data: {
        organizationId: orgId,
        scope: "DAILY",
        scopeKey: "",
        limitMicroUsd: usdToMicro(0.000001),
        isHardStop: true,
      },
    });
    await prisma.costRecord.create({
      data: {
        organizationId: orgId,
        category: "AI_TOKENS",
        costMicroUsd: usdToMicro(1),
        description: "pre-existing spend",
      },
    });
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "over budget" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();
    const state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("FAILED");
    expect((state.error as { code?: string } | null)?.code).toBe("COST_LIMIT");
    await prisma.costLimit.deleteMany({ where: { organizationId: orgId } });
  });

  it("cancel stops an in-flight run and voids pending approvals", async () => {
    const q = makeInlineQueue();
    const run = await startWorkflowRun({
      organizationId: orgId,
      workflowKey: "test-pipeline",
      input: { topic: "cancelled topic" },
      triggeredBy: { kind: "user", id: userId },
      enqueueAdvance: q.enqueue,
    });
    await q.drain();
    await cancelWorkflowRun({ organizationId: orgId, workflowRunId: run.id, userId });
    const state = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(state.status).toBe("CANCELLED");
    const pending = await prisma.approvalRequest.count({
      where: { workflowRunId: run.id, status: "PENDING" },
    });
    expect(pending).toBe(0);
  });
});

describe("readPath", () => {
  it("navigates nested context", () => {
    const ctx = { input: { topic: "x" }, steps: { research: { summary: "s" } } };
    expect(readPath(ctx, "$.input.topic")).toBe("x");
    expect(readPath(ctx, "$.steps.research.summary")).toBe("s");
    expect(readPath(ctx, "$.missing.deep")).toBeUndefined();
    expect(readPath(ctx, "$")).toBe(ctx);
  });
});
