import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@bf/database";

/**
 * Test fixtures: everything is created under a fresh organization per test
 * file so integration tests are isolated and repeatable.
 */
export async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function createTestOrg(): Promise<{ orgId: string; userId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Test Org ${suffix}`, slug: `test-${suffix}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `test-${suffix}@factory.local`,
      name: "Test User",
      passwordHash: "x",
    },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "OWNER" },
  });
  return { orgId: org.id, userId: user.id };
}

export async function cleanupTestOrg(orgId: string): Promise<void> {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
}

export async function createEchoAgent(orgId: string, key = "echo-agent"): Promise<void> {
  const agent = await prisma.agent.create({
    data: {
      organizationId: orgId,
      key,
      name: "Echo Agent",
      description: "Test agent using the mock provider",
      role: "tester",
      status: "ACTIVE",
    },
  });
  const version = await prisma.agentVersion.create({
    data: {
      agentId: agent.id,
      version: 1,
      instructions: "Return a structured result.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      } as Prisma.InputJsonValue,
      outputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" }, minItems: 2 },
        },
        required: ["summary", "keyPoints"],
      } as Prisma.InputJsonValue,
      allowedTools: [],
      forbiddenTools: [],
      provider: "mock",
      model: "mock-basic",
      maxCostMicroUsd: 1_000_000n,
      maxRetries: 2,
      timeoutMs: 30_000,
    },
  });
  await prisma.agent.update({ where: { id: agent.id }, data: { activeVersionId: version.id } });
}
