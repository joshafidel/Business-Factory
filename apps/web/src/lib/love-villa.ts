import { prisma } from "@bf/database";
import { LOVE_VILLA_MODULE } from "@bf/shared";
import type { Prisma } from "@bf/database";

/**
 * Lazy module registration: deployments that no longer run the seed
 * (SEED_ON_BUILD removed after first deploy) still get the Love Villa app
 * card the first time the dashboard renders. Idempotent and cheap — a
 * findFirst guard, then a single upsert only when missing or not installed.
 */
export async function ensureLoveVillaModule(organizationId: string): Promise<void> {
  const existing = await prisma.businessModule.findFirst({
    where: { organizationId, key: LOVE_VILLA_MODULE.key },
    select: { id: true, status: true },
  });
  if (existing?.status === "INSTALLED") return;
  await prisma.businessModule.upsert({
    where: { organizationId_key: { organizationId, key: LOVE_VILLA_MODULE.key } },
    create: {
      organizationId,
      key: LOVE_VILLA_MODULE.key,
      name: LOVE_VILLA_MODULE.name,
      description: LOVE_VILLA_MODULE.description,
      status: "INSTALLED",
      manifest: LOVE_VILLA_MODULE.manifest as unknown as Prisma.InputJsonValue,
    },
    update: { status: "INSTALLED" },
  });
}
