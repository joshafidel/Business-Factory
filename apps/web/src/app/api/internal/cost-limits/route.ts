import { prisma, writeAudit, type CostLimitScope } from "@bf/database";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/session";

/**
 * Cost-limit maintenance (Owner/Admin only) — scriptable counterpart of the
 * /costs dashboard form. GET reports configured limits alongside current
 * spend; POST upserts a limit on its stable (scope, scopeKey) key, same as
 * the seed and the dashboard action, with an audit trail.
 */

async function requireAdmin() {
  const ctx = await getOrgContext();
  if (!ctx) return null;
  if (!["OWNER", "ADMIN"].includes(ctx.role)) return null;
  return ctx;
}

export async function GET(): Promise<NextResponse> {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const limits = await prisma.costLimit.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ scope: "asc" }, { scopeKey: "asc" }],
  });
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [day, month] = await Promise.all([
    prisma.costRecord.aggregate({
      where: { organizationId: ctx.organizationId, isDemo: false, createdAt: { gte: dayStart } },
      _sum: { costMicroUsd: true },
    }),
    prisma.costRecord.aggregate({
      where: { organizationId: ctx.organizationId, isDemo: false, createdAt: { gte: monthStart } },
      _sum: { costMicroUsd: true },
    }),
  ]);
  return NextResponse.json({
    limits: limits.map((l) => ({
      scope: l.scope,
      scopeKey: l.scopeKey,
      limitUsd: Number(l.limitMicroUsd) / 1_000_000,
      warnAtFraction: l.warnAtFraction,
      isHardStop: l.isHardStop,
      isEnabled: l.isEnabled,
    })),
    spentTodayUsd: Number(day._sum.costMicroUsd ?? 0n) / 1_000_000,
    spentThisMonthUsd: Number(month._sum.costMicroUsd ?? 0n) / 1_000_000,
  });
}

const bodySchema = z.object({
  scope: z.enum(["RUN", "DAILY", "MONTHLY", "PROVIDER", "MODULE"]),
  scopeKey: z.string().max(64).default(""),
  limitUsd: z.number().positive().max(1_000_000),
  warnAtPercent: z.number().min(1).max(100).default(80),
  isHardStop: z.boolean().default(true),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid limit values" }, { status: 400 });
  }
  const { scope, scopeKey, limitUsd, warnAtPercent, isHardStop } = parsed.data;
  if ((scope === "PROVIDER" || scope === "MODULE") && !scopeKey) {
    return NextResponse.json({ error: `${scope} limits require a scope key` }, { status: 400 });
  }
  const limitMicroUsd = BigInt(Math.round(limitUsd * 1_000_000));
  const limit = await prisma.costLimit.upsert({
    where: {
      organizationId_scope_scopeKey: {
        organizationId: ctx.organizationId,
        scope: scope as CostLimitScope,
        scopeKey,
      },
    },
    create: {
      organizationId: ctx.organizationId,
      scope: scope as CostLimitScope,
      scopeKey,
      limitMicroUsd,
      warnAtFraction: warnAtPercent / 100,
      isHardStop,
    },
    update: {
      limitMicroUsd,
      warnAtFraction: warnAtPercent / 100,
      isHardStop,
      isEnabled: true,
    },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "cost_limit.saved",
    entityType: "CostLimit",
    entityId: limit.id,
    detail: { scope, scopeKey: scopeKey || null, limitUsd, isHardStop, via: "internal-api" },
  });
  return NextResponse.json({
    ok: true,
    limit: { scope, scopeKey, limitUsd, isHardStop },
  });
}
