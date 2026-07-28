import { prisma, writeAudit, type AgentRun, type Prisma } from "@bf/database";
import { resolvePromptVersion, renderTemplate } from "@bf/prompts";
import {
  estimateCostMicroUsd,
  getProviderRegistry,
  type ProviderRegistry,
  type ChatMessage,
} from "@bf/providers";
import {
  PlatformError,
  createLogger,
  isRetryable,
  toErrorRecord,
  validateJsonSchema,
} from "@bf/shared";
import { assertWithinCostLimits, recordCost } from "./cost-guard";

const log = createLogger("agent-runner");

export interface RunAgentParams {
  organizationId: string;
  /** Agent key within the org. */
  agentKey: string;
  goal: string;
  input: Record<string, unknown>;
  /** Link back to the workflow step that spawned this run, if any. */
  stepRunId?: string;
  workflowRunId?: string;
  moduleKey?: string | null;
  /** Extra prompt variables merged over the input when rendering. */
  variables?: Record<string, string>;
  registry?: ProviderRegistry;
}

export interface RunAgentResult {
  run: AgentRun;
  output: Record<string, unknown>;
}

/**
 * The base agent runner. One bounded execution:
 *  1. validate input against the version's input schema
 *  2. resolve the exact prompt version (recorded on the run)
 *  3. verify tool configuration
 *  4. pre-check cost limits
 *  5. call the configured provider (structured output)
 *  6. validate output against the output schema
 *  7. record usage + cost
 *  8. retry recoverable provider errors with backoff (bounded by maxRetries)
 *  9. mark FAILED and write an ErrorEvent when exhausted (escalation)
 *
 * Approval-gated agents do not pause here — the owning workflow step wraps
 * the run and routes its output through the approval system.
 */
export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const agent = await prisma.agent.findFirst({
    where: { organizationId: params.organizationId, key: params.agentKey },
    include: { activeVersion: true, module: true },
  });
  if (!agent) throw new PlatformError("NOT_FOUND", `Agent "${params.agentKey}" not found`);
  if (agent.status !== "ACTIVE") {
    throw new PlatformError("VALIDATION", `Agent "${params.agentKey}" is not active`);
  }
  const version = agent.activeVersion;
  if (!version)
    throw new PlatformError("VALIDATION", `Agent "${params.agentKey}" has no active version`);

  // 1. Validate input.
  const inputErrors = validateJsonSchema(
    version.inputSchema as Record<string, unknown>,
    params.input,
  );
  if (inputErrors.length > 0) {
    throw new PlatformError("VALIDATION", `Agent input invalid: ${inputErrors.join("; ")}`);
  }

  // 2. Resolve prompt version.
  const promptVersion = await resolvePromptVersion({
    promptId: version.promptId,
    promptVersionId: version.promptVersionId,
  });

  const run = await prisma.agentRun.create({
    data: {
      organizationId: params.organizationId,
      agentId: agent.id,
      agentVersionId: version.id,
      stepRunId: params.stepRunId,
      status: "RUNNING",
      goal: params.goal,
      input: params.input as Prisma.InputJsonValue,
      promptVersionId: promptVersion?.id,
      startedAt: new Date(),
    },
  });

  const registry = params.registry ?? getProviderRegistry();
  // Agents configured for a real provider fall back to mock until that
  // provider's API key is set — pipelines never break, and they upgrade to
  // real AI automatically when the key appears.
  let provider;
  try {
    provider = registry.get(version.provider);
  } catch {
    log.warn(
      { agentKey: agent.key, provider: version.provider },
      "provider not enabled; falling back to mock",
    );
    provider = registry.get("mock");
  }
  const moduleKey = params.moduleKey ?? agent.module?.key ?? null;

  const stringVars: Record<string, string> = Object.fromEntries(
    Object.entries(params.input).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
  const promptText = promptVersion
    ? renderTemplate(promptVersion.template, { ...stringVars, ...params.variables })
    : params.goal;

  const messages: ChatMessage[] = [
    { role: "system", content: version.instructions },
    {
      role: "user",
      content: [
        `Goal: ${params.goal}`,
        ``,
        promptText,
        ``,
        `Input data (JSON):`,
        JSON.stringify(params.input, null, 2),
      ].join("\n"),
    },
  ];

  let attempt = 0;
  let lastError: unknown = null;
  let totalCost = 0n;

  // Billing-failure failover: when the configured provider rejects for
  // credits/quota (a non-retryable account problem, not a model problem),
  // switch to the other real provider mid-run instead of failing the
  // pipeline. Self-healing: the next run tries the configured provider
  // first again.
  const FAILOVER: Record<string, { provider: string; model: string }> = {
    anthropic: { provider: "openai", model: "gpt-4o" },
    openai: { provider: "anthropic", model: "claude-sonnet-4-5" },
  };
  const isBillingError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    const body = JSON.stringify((err as { details?: unknown })?.details ?? "");
    return /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(
      `${msg} ${body}`,
    );
  };
  let activeModel = version.model;

  while (attempt <= version.maxRetries) {
    attempt += 1;
    try {
      // 4. Cost pre-check (org limits + per-run budget).
      await assertWithinCostLimits({
        organizationId: params.organizationId,
        moduleKey,
        providerKey: version.provider,
        runCostMicroUsd: totalCost,
        runLimitMicroUsd: version.maxCostMicroUsd,
      });

      // 5. Provider call.
      const result = await provider.generateObject({
        model: provider.key === "mock" ? "mock-basic" : activeModel,
        messages,
        temperature: version.temperature,
        maxTokens: version.maxTokens,
        schema: version.outputSchema as Record<string, unknown>,
        schemaName: `${agent.key}_output`,
        timeoutMs: version.timeoutMs,
      });

      // 6. Validate structured output.
      const outputErrors = validateJsonSchema(
        version.outputSchema as Record<string, unknown>,
        result.object,
      );
      if (outputErrors.length > 0) {
        throw new PlatformError(
          "PROVIDER_ERROR",
          `Output failed schema: ${outputErrors.join("; ")}`,
          {
            retryable: true,
          },
        );
      }

      // 7. Record usage and cost.
      const cost = estimateCostMicroUsd(
        activeModel,
        result.usage.inputTokens,
        result.usage.outputTokens,
      );
      totalCost += cost;
      await prisma.providerUsage.create({
        data: {
          organizationId: params.organizationId,
          providerKey: provider.key,
          model: provider.key === "mock" ? "mock-basic" : activeModel,
          operation: "generateObject",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costMicroUsd: cost,
          agentRunId: run.id,
          workflowRunId: params.workflowRunId,
        },
      });
      await recordCost({
        organizationId: params.organizationId,
        category: "AI_TOKENS",
        costMicroUsd: cost,
        moduleKey,
        workflowRunId: params.workflowRunId,
        agentRunId: run.id,
        providerKey: provider.key,
        description: `${agent.key} (${activeModel})`,
      });

      if (totalCost > version.maxCostMicroUsd) {
        throw new PlatformError("BUDGET_EXCEEDED", `Agent run exceeded its cost budget`);
      }

      const completed = await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          output: result.object as Prisma.InputJsonValue,
          inputTokens: { increment: result.usage.inputTokens },
          outputTokens: { increment: result.usage.outputTokens },
          costMicroUsd: totalCost,
          attempts: attempt,
          steps: 1,
          finishedAt: new Date(),
        },
      });
      await writeAudit({
        organizationId: params.organizationId,
        actorType: "agent",
        action: "agent.run.completed",
        entityType: "AgentRun",
        entityId: run.id,
        detail: { agentKey: agent.key, attempts: attempt },
      });
      return { run: completed, output: result.object as Record<string, unknown> };
    } catch (err) {
      lastError = err;
      const failover = FAILOVER[provider.key];
      if (isBillingError(err) && failover) {
        try {
          const alt = registry.get(failover.provider);
          log.warn(
            { runId: run.id, agentKey: agent.key, from: provider.key, to: failover.provider },
            "provider billing failure; failing over",
          );
          provider = alt;
          activeModel = failover.model;
          continue;
        } catch {
          // Alternate provider not enabled — fall through to normal handling.
        }
      }
      const retryable = isRetryable(err) && attempt <= version.maxRetries;
      log.warn(
        { runId: run.id, agentKey: agent.key, attempt, retryable, err: toErrorRecord(err) },
        "agent attempt failed",
      );
      if (!retryable) break;
      // 8. Exponential backoff between retries.
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 250, 5_000)));
    }
  }

  // 9. Exhausted: persist failure and escalate.
  const errorRecord = toErrorRecord(lastError);
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: "FAILED",
      error: errorRecord as unknown as Prisma.InputJsonValue,
      attempts: attempt,
      costMicroUsd: totalCost,
      finishedAt: new Date(),
    },
  });
  await prisma.errorEvent.create({
    data: {
      organizationId: params.organizationId,
      fingerprint: `agent:${agent.key}:${errorRecord.code}`,
      code: errorRecord.code,
      message: errorRecord.message,
      source: "agent-runner",
      agentRunId: run.id,
      workflowRunId: params.workflowRunId,
      detail: (errorRecord.details ?? {}) as Prisma.InputJsonValue,
    },
  });
  await writeAudit({
    organizationId: params.organizationId,
    actorType: "agent",
    action: "agent.run.failed",
    entityType: "AgentRun",
    entityId: run.id,
    detail: { agentKey: agent.key, code: errorRecord.code },
  });
  throw lastError instanceof Error
    ? lastError
    : new PlatformError("STEP_FAILED", "Agent run failed");
}
