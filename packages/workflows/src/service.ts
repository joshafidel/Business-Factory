import { prisma, writeAudit, type Prisma, type Workflow } from "@bf/database";
import { PlatformError } from "@bf/shared";
import {
  STEP_CONFIG_SCHEMAS,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "./definitions";

/**
 * Workflow definition management. Creating or editing a workflow always
 * produces a new immutable WorkflowVersion with its steps; runs pin the
 * version they started with.
 */
export async function upsertWorkflowFromDefinition(params: {
  organizationId: string;
  moduleId?: string | null;
  definition: WorkflowDefinition;
  activate?: boolean;
  userId?: string;
}): Promise<Workflow> {
  const def = workflowDefinitionSchema.parse(params.definition);

  // Validate every step config against its type's schema up front.
  for (const step of def.steps) {
    const schema = STEP_CONFIG_SCHEMAS[step.type];
    const result = schema.safeParse(step.config);
    if (!result.success) {
      throw new PlatformError(
        "VALIDATION",
        `Step "${step.key}" config invalid: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    let workflow = await tx.workflow.findFirst({
      where: { organizationId: params.organizationId, key: def.key },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!workflow) {
      workflow = {
        ...(await tx.workflow.create({
          data: {
            organizationId: params.organizationId,
            moduleId: params.moduleId,
            key: def.key,
            name: def.name,
            description: def.description,
            status: "DRAFT",
            costLimitMicroUsd: def.costLimitMicroUsd ?? 2_000_000n,
          },
        })),
        versions: [],
      };
    }

    const nextVersion = (workflow.versions[0]?.version ?? 0) + 1;
    const version = await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: nextVersion,
        inputSchema: def.inputSchema as Prisma.InputJsonValue,
        changelog: nextVersion === 1 ? "Initial version" : `Version ${nextVersion}`,
      },
    });
    let order = 0;
    for (const step of def.steps) {
      await tx.workflowStep.create({
        data: {
          workflowVersionId: version.id,
          key: step.key,
          name: step.name,
          type: step.type,
          order: order++,
          config: step.config as Prisma.InputJsonValue,
          retryLimit: step.retryLimit,
          timeoutMs: step.timeoutMs,
        },
      });
    }
    const updated = await tx.workflow.update({
      where: { id: workflow.id },
      data: {
        name: def.name,
        description: def.description,
        activeVersionId: version.id,
        ...(params.activate ? { status: "ACTIVE" } : {}),
      },
    });
    await writeAudit(
      {
        organizationId: params.organizationId,
        userId: params.userId,
        actorType: params.userId ? "user" : "system",
        action: "workflow.version.created",
        entityType: "Workflow",
        entityId: workflow.id,
        detail: { key: def.key, version: nextVersion },
      },
      tx,
    );
    return updated;
  });
}

export async function setWorkflowStatus(params: {
  organizationId: string;
  workflowId: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  userId?: string;
}): Promise<Workflow> {
  const workflow = await prisma.workflow.findFirst({
    where: { id: params.workflowId, organizationId: params.organizationId },
  });
  if (!workflow) throw new PlatformError("NOT_FOUND", "Workflow not found");
  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data: { status: params.status },
  });
  await writeAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    actorType: "user",
    action: "workflow.status.changed",
    entityType: "Workflow",
    entityId: workflow.id,
    detail: { from: workflow.status, to: params.status },
  });
  return updated;
}
