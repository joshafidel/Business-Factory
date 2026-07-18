import { runAgent } from "@bf/agents";
import { prisma, type Prisma, type WorkflowStep } from "@bf/database";
import { notify } from "@bf/notifications";
import { getStorage } from "@bf/storage";
import { PlatformError } from "@bf/shared";
import { STEP_CONFIG_SCHEMAS, getCodeFunction, readPath } from "./definitions";

/**
 * Step executors. Each returns the step's output object. Control-flow steps
 * (approval, delay, condition) are handled by the engine itself — executors
 * here are pure "do work, return output".
 */

export interface ExecContext {
  organizationId: string;
  workflowRunId: string;
  workflowKey: string;
  moduleKey: string | null;
  stepRunId: string;
  context: Record<string, unknown>;
}

export async function executeAgentTask(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.AGENT_TASK.parse(step.config);
  const input: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(config.inputMapping)) {
    input[field] = readPath(ctx.context, path);
  }
  const { output, run } = await runAgent({
    organizationId: ctx.organizationId,
    agentKey: config.agentKey,
    goal: config.goal,
    input,
    stepRunId: ctx.stepRunId,
    workflowRunId: ctx.workflowRunId,
    moduleKey: ctx.moduleKey,
  });
  return { ...output, _agentRunId: run.id, _costMicroUsd: run.costMicroUsd.toString() };
}

export async function executeApiCall(
  step: WorkflowStep,
  _ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.API_CALL.parse(step.config);
  // Outbound calls are restricted to http(s) and never carry org secrets
  // implicitly; integrations with credentials get purpose-built executors.
  const url = new URL(config.url);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new PlatformError("VALIDATION", `Unsupported protocol: ${url.protocol}`);
  }
  const res = await fetch(config.url, {
    method: config.method,
    headers: config.headers,
    body: config.bodyTemplate,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep as text
  }
  if (!res.ok) {
    throw new PlatformError("STEP_FAILED", `API call failed with ${res.status}`, {
      retryable: res.status >= 500,
      details: { status: res.status },
    });
  }
  return { status: res.status, body };
}

export async function executeCodeFunction(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.CODE_FUNCTION.parse(step.config);
  const fn = getCodeFunction(config.functionKey);
  if (!fn) {
    throw new PlatformError("VALIDATION", `Unknown code function "${config.functionKey}"`);
  }
  // Resolve "$." references in args against the run context.
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.args)) {
    args[key] =
      typeof value === "string" && value.startsWith("$.") ? readPath(ctx.context, value) : value;
  }
  return fn(args, ctx.context);
}

export async function executeTransform(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.TRANSFORM.parse(step.config);
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(config.mapping)) {
    out[field] = readPath(ctx.context, path);
  }
  return out;
}

export async function executeFileGeneration(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.FILE_GENERATION.parse(step.config);
  const content = readPath(ctx.context, config.contentPath);
  const body = typeof content === "string" ? content : JSON.stringify(content ?? null, null, 2);
  const storage = getStorage();
  const key = `${ctx.organizationId}/${ctx.workflowRunId}/${step.key}-${Date.now()}.${
    config.assetType === "JSON" ? "json" : "txt"
  }`;
  const stored = await storage.put(key, body, { contentType: config.mimeType });
  // Content that already passed an approval gate earlier in this run is saved
  // as APPROVED and linked to that request; otherwise it awaits review.
  const priorApproval = await prisma.approvalRequest.findFirst({
    where: { workflowRunId: ctx.workflowRunId, status: "APPROVED" },
    orderBy: { updatedAt: "desc" },
  });
  const asset = await prisma.asset.create({
    data: {
      organizationId: ctx.organizationId,
      name: config.assetName,
      type: config.assetType,
      mimeType: config.mimeType,
      storageDriver: storage.driver,
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      workflowRunId: ctx.workflowRunId,
      source: `workflow:${ctx.workflowKey}:${step.key}`,
      approvalStatus: priorApproval ? "APPROVED" : "PENDING_REVIEW",
      approvalRequestId: priorApproval?.id,
      metadata: { stepKey: step.key } as Prisma.InputJsonValue,
    },
  });
  return { assetId: asset.id, storageKey: stored.key, sizeBytes: stored.sizeBytes };
}

export async function executeNotification(
  step: WorkflowStep,
  ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.NOTIFICATION.parse(step.config);
  await notify({
    organizationId: ctx.organizationId,
    userId: null,
    kind: config.kind,
    title: config.title,
    body: config.bodyTemplate,
    href: `/runs/${ctx.workflowRunId}`,
  });
  return { notified: true };
}

export async function executePublish(
  step: WorkflowStep,
  _ctx: ExecContext,
): Promise<Record<string, unknown>> {
  const config = STEP_CONFIG_SCHEMAS.PUBLISH.parse(step.config);
  // No real external publishing targets exist yet. The engine has already
  // enforced approval before this step runs; the executor records the intent.
  return {
    published: false,
    target: config.target,
    note: "Publish targets are not connected yet; recorded as a dry run.",
  };
}
