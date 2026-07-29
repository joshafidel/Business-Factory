"use server";

import { revalidatePath } from "next/cache";
import { prisma, writeAudit } from "@bf/database";
import { usdToMicro } from "@bf/shared";
import { z } from "zod";
import { assertPermission } from "@/lib/session";

const itemSchema = z.object({
  kind: z.enum(["ONE_TIME", "SUBSCRIPTION"]),
  vendor: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  amountUsd: z.coerce.number().min(0).max(1_000_000),
  cadence: z.enum(["monthly", "annual"]).optional(),
  date: z.string().optional(), // purchase date or subscription start (yyyy-mm-dd)
  notes: z.string().trim().max(500).optional(),
});

function parseItem(formData: FormData) {
  return itemSchema.safeParse({
    kind: formData.get("kind"),
    vendor: formData.get("vendor"),
    name: formData.get("name"),
    amountUsd: formData.get("amountUsd"),
    cadence: (formData.get("cadence") as string) || undefined,
    date: (formData.get("date") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
}

/** Update an existing line item; confirming an amount clears the estimate flag. */
export async function savePurchaseAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await assertPermission("costs:manage");
  const parsed = parseItem(formData);
  if (!parsed.success) return { error: "Check the values — amount must be a number ≥ 0." };
  const { kind, vendor, name, amountUsd, cadence, date, notes } = parsed.data;
  const when = date ? new Date(`${date}T00:00:00Z`) : null;

  const existing = await prisma.purchaseRecord.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!existing) return { error: "Line item not found." };

  await prisma.purchaseRecord.update({
    where: { id: existing.id },
    data: {
      kind,
      vendor,
      name,
      amountMicroUsd: usdToMicro(amountUsd),
      cadence: kind === "SUBSCRIPTION" ? (cadence ?? "monthly") : null,
      startedAt: kind === "SUBSCRIPTION" ? (when ?? existing.startedAt ?? new Date()) : null,
      purchasedAt: kind === "ONE_TIME" ? (when ?? existing.purchasedAt ?? new Date()) : null,
      isEstimate: false,
      notes: notes ?? null,
    },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "spending.update",
    entityType: "PurchaseRecord",
    entityId: id,
  });
  revalidatePath("/spending");
  return {};
}

/** Add a new line item (owner-entered, so never an estimate). */
export async function addPurchaseAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("costs:manage");
  const parsed = parseItem(formData);
  if (!parsed.success) return { error: "Check the values — amount must be a number ≥ 0." };
  const { kind, vendor, name, amountUsd, cadence, date, notes } = parsed.data;
  const when = date ? new Date(`${date}T00:00:00Z`) : new Date();

  const created = await prisma.purchaseRecord.create({
    data: {
      organizationId: ctx.organizationId,
      key: `custom-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      vendor,
      name,
      amountMicroUsd: usdToMicro(amountUsd),
      cadence: kind === "SUBSCRIPTION" ? (cadence ?? "monthly") : null,
      startedAt: kind === "SUBSCRIPTION" ? when : null,
      purchasedAt: kind === "ONE_TIME" ? when : null,
      isEstimate: false,
      notes: notes ?? null,
    },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "spending.add",
    entityType: "PurchaseRecord",
    entityId: created.id,
  });
  revalidatePath("/spending");
  return {};
}

/** Cancel a subscription (stops its total-to-date clock today). */
export async function endSubscriptionAction(id: string): Promise<{ error?: string }> {
  const ctx = await assertPermission("costs:manage");
  const existing = await prisma.purchaseRecord.findFirst({
    where: { id, organizationId: ctx.organizationId, kind: "SUBSCRIPTION" },
  });
  if (!existing) return { error: "Subscription not found." };
  await prisma.purchaseRecord.update({
    where: { id: existing.id },
    data: { endedAt: existing.endedAt ? null : new Date() },
  });
  revalidatePath("/spending");
  return {};
}

/** Remove a line item entirely (e.g. a seeded account you never opened). */
export async function deletePurchaseAction(id: string): Promise<{ error?: string }> {
  const ctx = await assertPermission("costs:manage");
  const existing = await prisma.purchaseRecord.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!existing) return { error: "Line item not found." };
  await prisma.purchaseRecord.delete({ where: { id: existing.id } });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "spending.delete",
    entityType: "PurchaseRecord",
    entityId: id,
  });
  revalidatePath("/spending");
  return {};
}
