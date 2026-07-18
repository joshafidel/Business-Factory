import { prisma } from "@bf/database";

/**
 * Aggregation queries backing the Analytics and Costs dashboards.
 * All queries are org-scoped and exclude isDemo cost rows from real totals.
 */

export interface RateStat {
  total: number;
  succeeded: number;
  failed: number;
  rate: number | null;
}

function toRate(total: number, succeeded: number, failed: number): RateStat {
  return { total, succeeded, failed, rate: total > 0 ? succeeded / total : null };
}

export async function workflowSuccessRate(organizationId: string, days = 30): Promise<RateStat> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, succeeded, failed] = await Promise.all([
    prisma.workflowRun.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.workflowRun.count({
      where: { organizationId, status: "COMPLETED", createdAt: { gte: since } },
    }),
    prisma.workflowRun.count({
      where: { organizationId, status: "FAILED", createdAt: { gte: since } },
    }),
  ]);
  return toRate(total, succeeded, failed);
}

export async function agentSuccessRate(organizationId: string, days = 30): Promise<RateStat> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, succeeded, failed] = await Promise.all([
    prisma.agentRun.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.agentRun.count({
      where: { organizationId, status: "COMPLETED", createdAt: { gte: since } },
    }),
    prisma.agentRun.count({
      where: { organizationId, status: "FAILED", createdAt: { gte: since } },
    }),
  ]);
  return toRate(total, succeeded, failed);
}

export async function approvalRate(organizationId: string, days = 30): Promise<RateStat> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, approved, rejected] = await Promise.all([
    prisma.approvalRequest.count({
      where: { organizationId, createdAt: { gte: since }, status: { not: "PENDING" } },
    }),
    prisma.approvalRequest.count({
      where: { organizationId, status: "APPROVED", createdAt: { gte: since } },
    }),
    prisma.approvalRequest.count({
      where: { organizationId, status: "REJECTED", createdAt: { gte: since } },
    }),
  ]);
  return toRate(total, approved, rejected);
}

export async function avgRunDurationMs(organizationId: string, days = 30): Promise<number | null> {
  const since = new Date(Date.now() - days * 86_400_000);
  const runs = await prisma.workflowRun.findMany({
    where: {
      organizationId,
      status: "COMPLETED",
      startedAt: { not: null },
      finishedAt: { not: null },
      createdAt: { gte: since },
    },
    select: { startedAt: true, finishedAt: true },
    take: 500,
    orderBy: { createdAt: "desc" },
  });
  if (runs.length === 0) return null;
  const total = runs.reduce(
    (acc, r) => acc + ((r.finishedAt?.getTime() ?? 0) - (r.startedAt?.getTime() ?? 0)),
    0,
  );
  return total / runs.length;
}

export interface CostBucket {
  bucket: string;
  costMicroUsd: bigint;
}

export async function costOverTime(
  organizationId: string,
  days = 30,
  opts?: { includeDemo?: boolean },
): Promise<CostBucket[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.costRecord.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      ...(opts?.includeDemo ? {} : { isDemo: false }),
    },
    select: { createdAt: true, costMicroUsd: true },
  });
  const buckets = new Map<string, bigint>();
  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0n) + row.costMicroUsd);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, costMicroUsd]) => ({ bucket, costMicroUsd }));
}

export async function costByModule(
  organizationId: string,
  days = 30,
): Promise<{ moduleKey: string; costMicroUsd: bigint }[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.costRecord.groupBy({
    by: ["moduleKey"],
    where: { organizationId, isDemo: false, createdAt: { gte: since } },
    _sum: { costMicroUsd: true },
  });
  return rows.map((r) => ({
    moduleKey: r.moduleKey ?? "platform",
    costMicroUsd: r._sum.costMicroUsd ?? 0n,
  }));
}

export async function costByProvider(
  organizationId: string,
  days = 30,
): Promise<{ providerKey: string; costMicroUsd: bigint; calls: number }[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.providerUsage.groupBy({
    by: ["providerKey"],
    where: { organizationId, createdAt: { gte: since } },
    _sum: { costMicroUsd: true },
    _count: { _all: true },
  });
  return rows.map((r) => ({
    providerKey: r.providerKey,
    costMicroUsd: r._sum.costMicroUsd ?? 0n,
    calls: r._count._all,
  }));
}

export async function spendTotals(organizationId: string): Promise<{
  todayMicroUsd: bigint;
  monthMicroUsd: bigint;
}> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [day, month] = await Promise.all([
    prisma.costRecord.aggregate({
      where: { organizationId, isDemo: false, createdAt: { gte: dayStart } },
      _sum: { costMicroUsd: true },
    }),
    prisma.costRecord.aggregate({
      where: { organizationId, isDemo: false, createdAt: { gte: monthStart } },
      _sum: { costMicroUsd: true },
    }),
  ]);
  return {
    todayMicroUsd: day._sum.costMicroUsd ?? 0n,
    monthMicroUsd: month._sum.costMicroUsd ?? 0n,
  };
}

export async function jobsProcessed(organizationId: string, days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  return prisma.job.count({
    where: { organizationId, status: "COMPLETED", createdAt: { gte: since } },
  });
}

export async function assetsGenerated(organizationId: string, days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  return prisma.asset.count({ where: { organizationId, createdAt: { gte: since } } });
}
