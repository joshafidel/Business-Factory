"use server";

import { revalidatePath } from "next/cache";
import { prisma, writeAudit, type CostLimitScope } from "@bf/database";
import { usdToMicro } from "@bf/shared";
import { z } from "zod";
import { assertPermission } from "@/lib/session";

const limitSchema = z.object({
  scope: z.enum(["RUN", "DAILY", "MONTHLY", "PROVIDER", "MODULE"]),
  scopeKey: z.string().max(64).optional(),
  limitUsd: z.coerce.number().positive().max(1_000_000),
  warnAtPercent: z.coerce.number().min(1).max(100).default(80),
  isHardStop: z.coerce.boolean(),
});

export async function saveCostLimitAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("costs:manage");
  const parsed = limitSchema.safeParse({
    scope: formData.get("scope"),
    scopeKey: (formData.get("scopeKey") as string) || undefined,
    limitUsd: formData.get("limitUsd"),
    warnAtPercent: formData.get("warnAtPercent") || 80,
    isHardStop: formData.get("isHardStop") === "on",
  });
  if (!parsed.success) return { error: "Invalid limit values." };
  const { scope, scopeKey, limitUsd, warnAtPercent, isHardStop } = parsed.data;
  if ((scope === "PROVIDER" || scope === "MODULE") && !scopeKey) {
    return { error: `${scope} limits require a scope key.` };
  }

  await prisma.costLimit.upsert({
    where: {
      organizationId_scope_scopeKey: {
        organizationId: ctx.organizationId,
        scope: scope as CostLimitScope,
        scopeKey: scopeKey ?? "",
      },
    },
    create: {
      organizationId: ctx.organizationId,
      scope: scope as CostLimitScope,
      scopeKey: scopeKey ?? "",
      limitMicroUsd: usdToMicro(limitUsd),
      warnAtFraction: warnAtPercent / 100,
      isHardStop,
    },
    update: {
      limitMicroUsd: usdToMicro(limitUsd),
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
    detail: { scope, scopeKey: scopeKey ?? null, limitUsd, isHardStop },
  });
  revalidatePath("/costs");
  return {};
}

export async function toggleCostLimitAction(limitId: string): Promise<void> {
  const ctx = await assertPermission("costs:manage");
  const limit = await prisma.costLimit.findFirst({
    where: { id: limitId, organizationId: ctx.organizationId },
  });
  if (!limit) return;
  await prisma.costLimit.update({
    where: { id: limit.id },
    data: { isEnabled: !limit.isEnabled },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: limit.isEnabled ? "cost_limit.disabled" : "cost_limit.enabled",
    entityType: "CostLimit",
    entityId: limit.id,
  });
  revalidatePath("/costs");
}
