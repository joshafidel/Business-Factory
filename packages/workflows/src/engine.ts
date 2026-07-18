import { assertWithinCostLimits } from "@bf/agents";
import {
  prisma,
  writeAudit,
  type Prisma,
  type StepRun,
  type WorkflowRun,
  type WorkflowStep,
} from "@bf/database";
import { notify } from "@bf/notifications";
import {
  PlatformError,
  createLogger,
  isRetryable,
  toErrorRecord,
  validateJsonSchema,
} from "@bf/shared";
import { STEP_CONFIG_SCHEMAS, readPath } from "./definitions";
import { createApprovalRequest, evaluateApprovalPolicies } from "./approvals";
import {
  type ExecContext,
  executeAgentTask,
  executeApiCall,
  executeCodeFunction,
  executeFileGeneration,
  executeNotification,
  executePublish,
  executeTransform,
} from "./executors";

const log = createLogger("workflow-engine");

/**
 * Database-backed workflow state machine.
 *
 * The engine advances a run one or more steps per invocation, always from
 * persisted state, so a worker crash mid-run resumes safely. Control leaves
 * the loop when the run completes/fails, parks for approval, or waits on a
 * delay (a delayed queue job re-enters the loop).
 */

export interface EnqueueAdvance {
  (workflowRunId: string, organizationId: string, opts?: { delayMs?: number }): Promise<void>;
}

/** Rebuild the run context from persisted step outputs. */
export function buildContext(run: WorkflowRun, stepRuns: StepRun[]): Record<string, unknown> {
  const steps: Record<string, unknown> = {};
  for (const sr of stepRuns) {
    if (sr.status === "COMPLETED" && sr.output != null) {
      steps[sr.stepKey] = sr.output;
    }
  }
  return { input: run.input as Record<string, unknown>, steps };
}

export async function startWorkflowRun(params: {
  organizationId: string;
  workflowKey: string;
  input: Record<string, unknown>;
  triggeredBy: { kind: "user" | "schedule" | "api"; id: string };
  idempotencyKey?: string;
  parentRunId?: string;
  enqueueAdvance: EnqueueAdvance;
}): Promise<WorkflowRun> {
  const workflow = await prisma.workflow.findFirst({
    where: { organizationId: params.organizationId, key: params.workflowKey },
    include: { activeVersion: true, module: true },
  });
  if (!workflow) throw new PlatformError("NOT_FOUND", `Workflow "${params.workflowKey}" not found`);
  if (workflow.status !== "ACTIVE") {
    throw new PlatformError("VALIDATION", `Workflow "${params.workflowKey}" is not active`);
  }
  const version = workflow.activeVersion;
  if (!version) throw new PlatformError("VALIDATION", "Workflow has no active version");

  const inputErrors = validateJsonSchema(
    version.inputSchema as Record<string, unknown>,
    params.input,
  );
  if (inputErrors.length > 0) {
    throw new PlatformError("VALIDATION", `Workflow input invalid: ${inputErrors.join("; ")}`);
  }

  if (params.idempotencyKey) {
    const existing = await prisma.workflowRun.findFirst({
      where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;
  }

  const run = await prisma.workflowRun.create({
    data: {
      organizationId: params.organizationId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      status: "QUEUED",
      input: params.input as Prisma.InputJsonValue,
      triggeredBy: params.triggeredBy as unknown as Prisma.InputJsonValue,
      parentRunId: params.parentRunId,
      idempotencyKey: params.idempotencyKey,
    },
  });
  await writeAudit({
    organizationId: params.organizationId,
    userId: params.triggeredBy.kind === "user" ? params.triggeredBy.id : undefined,
    actorType: params.triggeredBy.kind === "user" ? "user" : "system",
    action: "workflow.run.started",
    entityType: "WorkflowRun",
    entityId: run.id,
    detail: { workflowKey: params.workflowKey },
  });
  await params.enqueueAdvance(run.id, params.organizationId);
  return run;
}

/**
 * Advance a run as far as possible. Invoked by the workflow queue processor.
 */
export async function advanceWorkflowRun(
  workflowRunId: string,
  enqueueAdvance: EnqueueAdvance,
): Promise<void> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      workflow: { include: { module: true } },
      workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } },
      stepRuns: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) throw new PlatformError("NOT_FOUND", `WorkflowRun ${workflowRunId} not found`);
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return;
  if (run.status === "AWAITING_APPROVAL") return; // resumed via approval decision
  if (run.status === "PAUSED") return;

  const steps = run.workflowVersion.steps;
  if (steps.length === 0) {
    await finishRun(run.id, run.organizationId, {}, run.workflow.key);
    return;
  }

  await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  // Resolve the step to execute: the run's currentStepKey, else the first step.
  let current: WorkflowStep | undefined =
    steps.find((s) => s.key === run.currentStepKey) ?? steps[0];

  // Track live copies of stepRuns for context building.
  const stepRunsLive = [...run.stepRuns];

  while (current) {
    const step: WorkflowStep = current;
    const context = buildContext(run, stepRunsLive);

    // Skip steps that already completed (e.g. after approval resume).
    const priorRun = stepRunsLive.find(
      (sr) => sr.workflowStepId === step.id && ["COMPLETED", "SKIPPED"].includes(sr.status),
    );
    if (priorRun) {
      current = nextStep(steps, step, priorRun);
      continue;
    }

    // Cost guard before every step (billable work happens inside steps).
    try {
      await assertWithinCostLimits({
        organizationId: run.organizationId,
        moduleKey: run.workflow.module?.key ?? null,
        runCostMicroUsd: run.costMicroUsd,
        runLimitMicroUsd: run.workflow.costLimitMicroUsd,
      });
    } catch (err) {
      await failRun(run.id, run.organizationId, err, run.workflow.key);
      return;
    }

    const stepRun = await prisma.stepRun.create({
      data: {
        workflowRunId: run.id,
        workflowStepId: step.id,
        stepKey: step.key,
        status: "RUNNING",
        attempt: stepRunsLive.filter((sr) => sr.workflowStepId === step.id).length + 1,
        input: context as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });
    stepRunsLive.push(stepRun);
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { currentStepKey: step.key },
    });

    // ── Control-flow steps handled by the engine ──
    if (step.type === "HUMAN_APPROVAL" || step.type === "PUBLISH") {
      const needsApproval = await prepareApprovalGate(run, step, stepRun, context);
      if (needsApproval) return; // parked; a decision resumes the run
      // PUBLISH with satisfied approval falls through to execution below.
    }

    if (step.type === "DELAY") {
      const config = STEP_CONFIG_SCHEMAS.DELAY.parse(step.config);
      await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "COMPLETED",
          output: { delayedMs: config.delayMs },
          finishedAt: new Date(),
        },
      });
      const next = nextStep(steps, step, null);
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { currentStepKey: next?.key ?? null, status: "QUEUED" },
      });
      if (next) {
        await enqueueAdvance(run.id, run.organizationId, { delayMs: config.delayMs });
      } else {
        await finishRun(
          run.id,
          run.organizationId,
          buildContext(run, stepRunsLive),
          run.workflow.key,
        );
      }
      return;
    }

    if (step.type === "CONDITION") {
      const config = STEP_CONFIG_SCHEMAS.CONDITION.parse(step.config);
      const left = readPath(context, config.path);
      const passed = evaluateCondition(left, config.op, config.value);
      const goTo = passed ? null : (config.elseGoTo ?? null);
      const updated = await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "COMPLETED",
          output: { passed, goTo } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      stepRunsLive[stepRunsLive.length - 1] = updated;
      current = nextStep(steps, step, updated);
      continue;
    }

    // ── Work steps ──
    try {
      const output = await executeWorkStep(step, {
        organizationId: run.organizationId,
        workflowRunId: run.id,
        workflowKey: run.workflow.key,
        moduleKey: run.workflow.module?.key ?? null,
        stepRunId: stepRun.id,
        context,
      });
      const stepCost = extractCost(output);
      const updated = await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "COMPLETED",
          output: output as Prisma.InputJsonValue,
          costMicroUsd: stepCost,
          finishedAt: new Date(),
        },
      });
      stepRunsLive[stepRunsLive.length - 1] = updated;
      if (stepCost > 0n) {
        run.costMicroUsd += stepCost;
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { costMicroUsd: run.costMicroUsd },
        });
      }
      current = nextStep(steps, step, updated);
    } catch (err) {
      const record = toErrorRecord(err);
      const attempts = stepRunsLive.filter((sr) => sr.workflowStepId === step.id).length;
      await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "FAILED",
          error: record as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      if (isRetryable(err) && attempts <= step.retryLimit) {
        log.warn(
          { runId: run.id, stepKey: step.key, attempts },
          "step failed; re-enqueueing with backoff",
        );
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: "QUEUED" },
        });
        await enqueueAdvance(run.id, run.organizationId, {
          delayMs: Math.min(2 ** attempts * 2_000, 60_000),
        });
        return;
      }
      await prisma.errorEvent.create({
        data: {
          organizationId: run.organizationId,
          fingerprint: `workflow:${run.workflow.key}:${step.key}:${record.code}`,
          code: record.code,
          message: record.message,
          source: "workflow-engine",
          workflowRunId: run.id,
          detail: (record.details ?? {}) as Prisma.InputJsonValue,
        },
      });
      await failRun(run.id, run.organizationId, err, run.workflow.key);
      return;
    }
  }

  await finishRun(run.id, run.organizationId, buildContext(run, stepRunsLive), run.workflow.key);
}

/** Create the approval gate for a HUMAN_APPROVAL/PUBLISH step. Returns true when parked. */
async function prepareApprovalGate(
  run: WorkflowRun & { workflow: { key: string; module: { key: string } | null } },
  step: WorkflowStep,
  stepRun: StepRun,
  context: Record<string, unknown>,
): Promise<boolean> {
  const isPublish = step.type === "PUBLISH";
  const config = isPublish
    ? {
        title: `Publish approval: ${step.name}`,
        description: "A publish action requires human approval before execution.",
        actionType: "PUBLISH_CONTENT" as const,
        riskLevel: "HIGH" as const,
        payloadPaths: ["$"],
      }
    : STEP_CONFIG_SCHEMAS.HUMAN_APPROVAL.parse(step.config);

  // Publish/approval steps ALWAYS gate; policies can only escalate the role.
  const policy = await evaluateApprovalPolicies({
    organizationId: run.organizationId,
    moduleKey: run.workflow.module?.key ?? null,
    workflowKey: run.workflow.key,
    stepKey: step.key,
    actionType: config.actionType,
    estimatedCostMicroUsd: run.costMicroUsd,
    riskLevel: config.riskLevel,
  });

  const payload: Record<string, unknown> = {};
  for (const path of config.payloadPaths.length > 0 ? config.payloadPaths : ["$"]) {
    payload[path] = readPath(context, path);
  }

  await createApprovalRequest({
    organizationId: run.organizationId,
    workflowRunId: run.id,
    stepRunId: stepRun.id,
    title: config.title,
    description: config.description,
    actionType: config.actionType,
    riskLevel: config.riskLevel,
    payload,
    estimatedCostMicroUsd: run.costMicroUsd,
    requiredRole: policy.requiredRole,
  });
  await prisma.stepRun.update({
    where: { id: stepRun.id },
    data: { status: "AWAITING_APPROVAL" },
  });
  await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: "AWAITING_APPROVAL" },
  });
  return true;
}

/**
 * Apply a human decision to the parked run. APPROVED resumes (PUBLISH steps
 * execute after approval), REJECTED cancels the run, REVISION_REQUESTED
 * re-runs the producing step and re-gates.
 */
export async function applyApprovalDecision(params: {
  approvalRequestId: string;
  enqueueAdvance: EnqueueAdvance;
}): Promise<void> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: params.approvalRequestId },
  });
  if (!request || !request.workflowRunId || !request.stepRunId) return;
  const stepRun = await prisma.stepRun.findUnique({
    where: { id: request.stepRunId },
    include: { workflowStep: true },
  });
  const run = await prisma.workflowRun.findUnique({
    where: { id: request.workflowRunId },
    include: { workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  if (!stepRun || !run || run.status !== "AWAITING_APPROVAL") return;

  if (request.status === "APPROVED") {
    if (stepRun.workflowStep.type === "PUBLISH") {
      // Execute the publish now that it is approved.
      const context = buildContext(
        run,
        await prisma.stepRun.findMany({ where: { workflowRunId: run.id } }),
      );
      const output = await executePublish(stepRun.workflowStep, {
        organizationId: run.organizationId,
        workflowRunId: run.id,
        workflowKey: "",
        moduleKey: null,
        stepRunId: stepRun.id,
        context,
      });
      await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "COMPLETED",
          output: { ...output, approved: true } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
    } else {
      await prisma.stepRun.update({
        where: { id: stepRun.id },
        data: {
          status: "COMPLETED",
          output: { approved: true, approvalRequestId: request.id } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      // Approved assets attached to this run move to APPROVED.
      await prisma.asset.updateMany({
        where: { workflowRunId: run.id, approvalStatus: "PENDING_REVIEW" },
        data: { approvalStatus: "APPROVED", approvalRequestId: request.id },
      });
    }
    const steps = run.workflowVersion.steps;
    const idx = steps.findIndex((s) => s.id === stepRun.workflowStepId);
    const next = idx >= 0 ? steps[idx + 1] : undefined;
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: "QUEUED", currentStepKey: next?.key ?? null },
    });
    await params.enqueueAdvance(run.id, run.organizationId);
    if (!next) {
      // Approval was the final step; finish immediately on next advance.
    }
    return;
  }

  if (request.status === "REJECTED") {
    await prisma.stepRun.update({
      where: { id: stepRun.id },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    await prisma.asset.updateMany({
      where: { workflowRunId: run.id, approvalStatus: "PENDING_REVIEW" },
      data: { approvalStatus: "REJECTED", approvalRequestId: request.id },
    });
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        error: { code: "CANCELLED", message: "Rejected by reviewer" } as Prisma.InputJsonValue,
      },
    });
    return;
  }

  if (request.status === "REVISION_REQUESTED") {
    // Re-run the step that produced the reviewed output: the nearest prior
    // AGENT_TASK (fallback: previous step), then hit the gate again.
    const steps = run.workflowVersion.steps;
    const gateIdx = steps.findIndex((s) => s.id === stepRun.workflowStepId);
    let target = gateIdx - 1;
    for (let i = gateIdx - 1; i >= 0; i--) {
      const candidate = steps[i];
      if (candidate && candidate.type === "AGENT_TASK") {
        target = i;
        break;
      }
    }
    const targetStep = steps[Math.max(0, target)];
    if (!targetStep) return;
    // Invalidate outputs from the target step onward so they re-execute.
    // CANCELLED (not SKIPPED): the advance loop treats SKIPPED as "done".
    const invalidKeys = steps.slice(Math.max(0, target)).map((s) => s.id);
    await prisma.stepRun.updateMany({
      where: {
        workflowRunId: run.id,
        workflowStepId: { in: invalidKeys },
        status: { in: ["COMPLETED", "AWAITING_APPROVAL"] },
      },
      data: { status: "CANCELLED" },
    });
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: "QUEUED", currentStepKey: targetStep.key },
    });
    await params.enqueueAdvance(run.id, run.organizationId);
  }
}

export async function cancelWorkflowRun(params: {
  organizationId: string;
  workflowRunId: string;
  userId?: string;
}): Promise<void> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: params.workflowRunId, organizationId: params.organizationId },
  });
  if (!run) throw new PlatformError("NOT_FOUND", "Workflow run not found");
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
    throw new PlatformError("CONFLICT", `Run is already ${run.status}`);
  }
  await prisma.workflowRun.update({
    where: { id: run.id },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      error: { code: "CANCELLED", message: "Cancelled by user" } as Prisma.InputJsonValue,
    },
  });
  await prisma.approvalRequest.updateMany({
    where: { workflowRunId: run.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await writeAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    actorType: "user",
    action: "workflow.run.cancelled",
    entityType: "WorkflowRun",
    entityId: run.id,
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nextStep(
  steps: WorkflowStep[],
  current: WorkflowStep,
  stepRun: StepRun | null,
): WorkflowStep | undefined {
  // Condition steps may carry a goTo in their output.
  const output = stepRun?.output as { goTo?: string | null } | null;
  if (output?.goTo) {
    return steps.find((s) => s.key === output.goTo);
  }
  const idx = steps.findIndex((s) => s.id === current.id);
  return steps[idx + 1];
}

function evaluateCondition(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    case "contains":
      return typeof left === "string" && typeof right === "string" && left.includes(right);
    case "exists":
      return left !== undefined && left !== null;
    default:
      return false;
  }
}

async function executeWorkStep(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  switch (step.type) {
    case "AGENT_TASK":
      return executeAgentTask(step, ctx);
    case "API_CALL":
      return executeApiCall(step, ctx);
    case "CODE_FUNCTION":
      return executeCodeFunction(step, ctx);
    case "TRANSFORM":
      return executeTransform(step, ctx);
    case "FILE_GENERATION":
      return executeFileGeneration(step, ctx);
    case "NOTIFICATION":
      return executeNotification(step, ctx);
    case "PUBLISH":
      return executePublish(step, ctx);
    case "CHILD_WORKFLOW":
      throw new PlatformError(
        "VALIDATION",
        "CHILD_WORKFLOW steps must be started via the worker (needs enqueue access)",
      );
    default:
      throw new PlatformError("VALIDATION", `Step type ${step.type} is not executable here`);
  }
}

function extractCost(output: Record<string, unknown>): bigint {
  const raw = output._costMicroUsd;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
  return 0n;
}

async function finishRun(
  runId: string,
  organizationId: string,
  context: Record<string, unknown>,
  workflowKey: string,
): Promise<void> {
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      output: context as Prisma.InputJsonValue,
      currentStepKey: null,
      finishedAt: new Date(),
    },
  });
  await notify({
    organizationId,
    userId: null,
    kind: "WORKFLOW_COMPLETED",
    title: `Workflow completed: ${workflowKey}`,
    body: "The run finished successfully.",
    href: `/runs/${runId}`,
  });
  await writeAudit({
    organizationId,
    actorType: "workflow",
    action: "workflow.run.completed",
    entityType: "WorkflowRun",
    entityId: runId,
  });
}

async function failRun(
  runId: string,
  organizationId: string,
  err: unknown,
  workflowKey: string,
): Promise<void> {
  const record = toErrorRecord(err);
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      error: record as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  await notify({
    organizationId,
    userId: null,
    kind: "WORKFLOW_FAILED",
    title: `Workflow failed: ${workflowKey}`,
    body: record.message,
    href: `/runs/${runId}`,
  });
  await writeAudit({
    organizationId,
    actorType: "workflow",
    action: "workflow.run.failed",
    entityType: "WorkflowRun",
    entityId: runId,
    detail: { code: record.code },
  });
}
