"use server";

import { revalidatePath } from "next/cache";
import { prisma, writeAudit } from "@bf/database";
import { notify } from "@bf/notifications";
import { PlatformError } from "@bf/shared";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { encryptSecret, maskSecret, resolveSecretReference } from "@/lib/secrets";

/**
 * Test an integration's connection. With no real external services connected
 * yet, "test" verifies that the integration's secret reference resolves
 * server-side (env var present / ciphertext decrypts). Real integrations will
 * replace this with an actual API ping per integration key.
 */
export async function testConnectionAction(integrationId: string): Promise<void> {
  const ctx = await assertPermission("integrations:manage");
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, organizationId: ctx.organizationId },
    include: { secrets: true },
  });
  if (!integration) throw new PlatformError("NOT_FOUND", "Integration not found");

  let ok = integration.secrets.length > 0;
  let error: string | null = null;
  for (const secret of integration.secrets) {
    const value = resolveSecretReference(secret.source, secret.reference);
    if (!value) {
      ok = false;
      error = `Secret "${secret.key}" could not be resolved (${
        secret.source === "ENV" ? `env var ${secret.reference} not set` : "decryption failed"
      })`;
      break;
    }
  }
  if (integration.secrets.length === 0) {
    error = "No credentials configured yet";
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: ok ? "CONNECTED" : integration.secrets.length === 0 ? "NOT_CONFIGURED" : "ERROR",
      lastCheckedAt: new Date(),
      lastError: error,
    },
  });
  if (!ok && integration.secrets.length > 0) {
    await notify({
      organizationId: ctx.organizationId,
      userId: null,
      kind: "INTEGRATION_FAILURE",
      title: `Integration check failed: ${integration.name}`,
      body: error ?? "Unknown error",
      href: "/integrations",
    });
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "integration.test_connection",
    entityType: "Integration",
    entityId: integration.id,
    detail: { ok },
  });
  revalidatePath("/integrations");
}

const secretSchema = z.object({
  integrationId: z.string().min(1),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  source: z.enum(["ENV", "ENCRYPTED"]),
  value: z.string().min(1).max(4096),
});

/**
 * Store a credential for an integration. ENV stores only the variable NAME;
 * ENCRYPTED encrypts the value with AES-256-GCM. Raw secrets never reach a
 * normal DB column and are never echoed back to the browser.
 */
export async function saveSecretAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("integrations:manage");
  const parsed = secretSchema.safeParse({
    integrationId: formData.get("integrationId"),
    key: formData.get("key"),
    source: formData.get("source"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { error: "All fields are required." };
  const { integrationId, key, source, value } = parsed.data;

  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, organizationId: ctx.organizationId },
  });
  if (!integration) return { error: "Integration not found." };

  const reference = source === "ENV" ? value : encryptSecret(value);
  const maskedPreview = source === "ENV" ? `env:${value}` : maskSecret(value);

  await prisma.secretReference.upsert({
    where: {
      organizationId_key: { organizationId: ctx.organizationId, key: `${integration.key}.${key}` },
    },
    create: {
      organizationId: ctx.organizationId,
      integrationId,
      key: `${integration.key}.${key}`,
      source,
      reference,
      maskedPreview,
    },
    update: { source, reference, maskedPreview },
  });
  await prisma.integration.update({
    where: { id: integrationId },
    data: { status: "CONFIGURED" },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "integration.secret_saved",
    entityType: "Integration",
    entityId: integrationId,
    // Only the key name is audited — never the value.
    detail: { secretKey: key, source },
  });
  revalidatePath("/integrations");
  return {};
}
