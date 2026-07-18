import { prisma, type CostCategory, type Prisma } from "@bf/database";
import { notify } from "@bf/notifications";
import { PlatformError, formatMicroUsd } from "@bf/shared";

/**
 * Cost enforcement. Called BEFORE any billable operation continues and AFTER
 * usage is recorded. Hard-stop limits throw COST_LIMIT (non-retryable), which
 * fails the run; warning thresholds emit a notification once per limit per day.
 */

export interface CostCheckContext {
  organizationId: string;
  moduleKey?: string | null;
  providerKey?: string | null;
  /** Cost already accumulated by the current run (for RUN scope checks). */
  runCostMicroUsd?: bigint;
  /** Per-run ceiling from the workflow/agent definition, if any. */
  runLimitMicroUsd?: bigint | null;
}

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function spentSince(
  organizationId: string,
  since: Date,
  extra?: Prisma.CostRecordWhereInput,
): Promise<bigint> {
  const agg = await prisma.costRecord.aggregate({
    where: { organizationId, isDemo: false, createdAt: { gte: since }, ...extra },
    _sum: { costMicroUsd: true },
  });
  return agg._sum.costMicroUsd ?? 0n;
}

/** Throws PlatformError(COST_LIMIT) when a hard limit would be exceeded. */
export async function assertWithinCostLimits(ctx: CostCheckContext): Promise<void> {
  // Per-run ceiling from the definition itself.
  if (
    ctx.runLimitMicroUsd != null &&
    ctx.runCostMicroUsd != null &&
    ctx.runCostMicroUsd >= ctx.runLimitMicroUsd
  ) {
    throw new PlatformError(
      "COST_LIMIT",
      `Run cost ${formatMicroUsd(ctx.runCostMicroUsd)} reached its limit ${formatMicroUsd(ctx.runLimitMicroUsd)}`,
    );
  }

  const limits = await prisma.costLimit.findMany({
    where: { organizationId: ctx.organizationId, isEnabled: true },
  });
  if (limits.length === 0) return;
  const now = new Date();

  for (const limit of limits) {
    let spent: bigint | null = null;
    switch (limit.scope) {
      case "RUN":
        if (ctx.runCostMicroUsd != null && ctx.runCostMicroUsd >= limit.limitMicroUsd) {
          spent = ctx.runCostMicroUsd;
        }
        break;
      case "DAILY":
        spent = await spentSince(ctx.organizationId, startOfDayUtc(now));
        break;
      case "MONTHLY":
        spent = await spentSince(ctx.organizationId, startOfMonthUtc(now));
        break;
      case "PROVIDER":
        if (ctx.providerKey && limit.scopeKey === ctx.providerKey) {
          spent = await spentSince(ctx.organizationId, startOfMonthUtc(now), {
            providerKey: ctx.providerKey,
          });
        }
        break;
      case "MODULE":
        if (ctx.moduleKey && limit.scopeKey === ctx.moduleKey) {
          spent = await spentSince(ctx.organizationId, startOfMonthUtc(now), {
            moduleKey: ctx.moduleKey,
          });
        }
        break;
    }
    if (spent == null) continue;

    if (spent >= limit.limitMicroUsd) {
      if (limit.isHardStop) {
        await notify({
          organizationId: ctx.organizationId,
          userId: null,
          kind: "COST_LIMIT_REACHED",
          title: `Cost limit reached (${limit.scope}${limit.scopeKey ? `:${limit.scopeKey}` : ""})`,
          body: `Spend ${formatMicroUsd(spent)} reached the ${formatMicroUsd(limit.limitMicroUsd)} limit. Execution blocked.`,
          href: "/costs",
        });
        throw new PlatformError(
          "COST_LIMIT",
          `${limit.scope} cost limit reached: ${formatMicroUsd(spent)} >= ${formatMicroUsd(limit.limitMicroUsd)}`,
          { details: { scope: limit.scope, scopeKey: limit.scopeKey } },
        );
      }
    } else if (Number(spent) >= Number(limit.limitMicroUsd) * limit.warnAtFraction) {
      // Fire the warning at most once per day per limit.
      const existing = await prisma.notification.findFirst({
        where: {
          organizationId: ctx.organizationId,
          kind: "COST_WARNING",
          title: { contains: limit.scope },
          createdAt: { gte: startOfDayUtc(now) },
        },
      });
      if (!existing) {
        await notify({
          organizationId: ctx.organizationId,
          userId: null,
          kind: "COST_WARNING",
          title: `Cost warning (${limit.scope}${limit.scopeKey ? `:${limit.scopeKey}` : ""})`,
          body: `Spend ${formatMicroUsd(spent)} is at ${Math.round((Number(spent) / Number(limit.limitMicroUsd)) * 100)}% of the ${formatMicroUsd(limit.limitMicroUsd)} limit.`,
          href: "/costs",
        });
      }
    }
  }
}

/** Record spend into CostRecord (the ledger the guard reads). */
export async function recordCost(params: {
  organizationId: string;
  category: CostCategory;
  costMicroUsd: bigint;
  moduleKey?: string | null;
  workflowRunId?: string | null;
  agentRunId?: string | null;
  providerKey?: string | null;
  description?: string;
}): Promise<void> {
  if (params.costMicroUsd <= 0n) return;
  await prisma.costRecord.create({
    data: {
      organizationId: params.organizationId,
      category: params.category,
      costMicroUsd: params.costMicroUsd,
      moduleKey: params.moduleKey,
      workflowRunId: params.workflowRunId,
      agentRunId: params.agentRunId,
      providerKey: params.providerKey,
      description: params.description,
    },
  });
}
