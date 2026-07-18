import { prisma, writeAudit, type Prompt, type PromptVersion } from "@bf/database";
import { PlatformError } from "@bf/shared";
import { extractVariables } from "./render";

/**
 * Prompt library: versioned, assignable to agents, roll-backable.
 * Every mutation creates a new immutable PromptVersion; "rollback" makes an
 * old version active again (it never rewrites history).
 */

export async function createPrompt(params: {
  organizationId: string;
  key: string;
  name: string;
  description?: string;
  template: string;
  userId?: string;
}): Promise<Prompt & { activeVersion: PromptVersion | null }> {
  const prompt = await prisma.$transaction(async (tx) => {
    const created = await tx.prompt.create({
      data: {
        organizationId: params.organizationId,
        key: params.key,
        name: params.name,
        description: params.description,
      },
    });
    const version = await tx.promptVersion.create({
      data: {
        promptId: created.id,
        version: 1,
        template: params.template,
        variables: extractVariables(params.template),
        changelog: "Initial version",
      },
    });
    await tx.prompt.update({ where: { id: created.id }, data: { activeVersionId: version.id } });
    await writeAudit(
      {
        organizationId: params.organizationId,
        userId: params.userId,
        actorType: params.userId ? "user" : "system",
        action: "prompt.create",
        entityType: "Prompt",
        entityId: created.id,
        detail: { key: params.key },
      },
      tx,
    );
    return created.id;
  });
  return prisma.prompt.findUniqueOrThrow({
    where: { id: prompt },
    include: { activeVersion: true },
  });
}

/** Create a new version and make it active. */
export async function updatePrompt(params: {
  organizationId: string;
  promptId: string;
  template: string;
  changelog?: string;
  userId?: string;
}): Promise<PromptVersion> {
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.prompt.findFirst({
      where: { id: params.promptId, organizationId: params.organizationId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!prompt) throw new PlatformError("NOT_FOUND", "Prompt not found");
    const nextVersion = (prompt.versions[0]?.version ?? 0) + 1;
    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: nextVersion,
        template: params.template,
        variables: extractVariables(params.template),
        changelog: params.changelog ?? `Version ${nextVersion}`,
      },
    });
    await tx.prompt.update({ where: { id: prompt.id }, data: { activeVersionId: version.id } });
    await writeAudit(
      {
        organizationId: params.organizationId,
        userId: params.userId,
        actorType: params.userId ? "user" : "system",
        action: "prompt.update",
        entityType: "Prompt",
        entityId: prompt.id,
        detail: { version: nextVersion },
      },
      tx,
    );
    return version;
  });
}

/** Make a previous version active again. */
export async function rollbackPrompt(params: {
  organizationId: string;
  promptId: string;
  toVersion: number;
  userId?: string;
}): Promise<PromptVersion> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.promptVersion.findFirst({
      where: {
        promptId: params.promptId,
        version: params.toVersion,
        prompt: { organizationId: params.organizationId },
      },
    });
    if (!target) throw new PlatformError("NOT_FOUND", "Prompt version not found");
    await tx.prompt.update({
      where: { id: params.promptId },
      data: { activeVersionId: target.id },
    });
    await writeAudit(
      {
        organizationId: params.organizationId,
        userId: params.userId,
        actorType: params.userId ? "user" : "system",
        action: "prompt.rollback",
        entityType: "Prompt",
        entityId: params.promptId,
        detail: { toVersion: params.toVersion },
      },
      tx,
    );
    return target;
  });
}

/**
 * Resolve the exact prompt version an agent run should use.
 * Pinned version wins; otherwise the prompt's active version.
 */
export async function resolvePromptVersion(params: {
  promptId?: string | null;
  promptVersionId?: string | null;
}): Promise<PromptVersion | null> {
  if (params.promptVersionId) {
    return prisma.promptVersion.findUnique({ where: { id: params.promptVersionId } });
  }
  if (params.promptId) {
    const prompt = await prisma.prompt.findUnique({
      where: { id: params.promptId },
      include: { activeVersion: true },
    });
    return prompt?.activeVersion ?? null;
  }
  return null;
}
