import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@bf/database";
import { MockProvider, ProviderRegistry } from "@bf/providers";
import { PlatformError, usdToMicro } from "@bf/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../runner";
import { assertWithinCostLimits, recordCost } from "../cost-guard";

let available = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  available = false;
}

const suffix = randomUUID().slice(0, 8);
let orgId: string;

beforeAll(async () => {
  if (!available) return;
  const org = await prisma.organization.create({
    data: { name: `Runner Test ${suffix}`, slug: `runner-${suffix}` },
  });
  orgId = org.id;
  const agent = await prisma.agent.create({
    data: {
      organizationId: orgId,
      key: "test-agent",
      name: "Test Agent",
      description: "",
      role: "tester",
      status: "ACTIVE",
    },
  });
  const version = await prisma.agentVersion.create({
    data: {
      agentId: agent.id,
      version: 1,
      instructions: "Test.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", minLength: 3 } },
        required: ["topic"],
      } as Prisma.InputJsonValue,
      outputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      } as Prisma.InputJsonValue,
      allowedTools: [],
      forbiddenTools: [],
      provider: "mock",
      model: "mock-basic",
      maxRetries: 2,
    },
  });
  await prisma.agent.update({ where: { id: agent.id }, data: { activeVersionId: version.id } });
});

afterAll(async () => {
  if (available && orgId) await prisma.organization.delete({ where: { id: orgId } });
});

describe.skipIf(!available)("agent runner (integration)", () => {
  it("rejects invalid input before any provider call", async () => {
    await expect(
      runAgent({ organizationId: orgId, agentKey: "test-agent", goal: "g", input: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // No run row should be RUNNING/FAILED — validation happens pre-create.
    const runs = await prisma.agentRun.count({ where: { organizationId: orgId } });
    expect(runs).toBe(0);
  });

  it("completes a run, records usage and history", async () => {
    const { run, output } = await runAgent({
      organizationId: orgId,
      agentKey: "test-agent",
      goal: "Summarize",
      input: { topic: "container gardening" },
    });
    expect(run.status).toBe("COMPLETED");
    expect(output.summary).toBeTypeOf("string");
    expect(run.inputTokens).toBeGreaterThan(0);
    const usage = await prisma.providerUsage.count({ where: { agentRunId: run.id } });
    expect(usage).toBe(1);
  });

  it("retries transient provider failures and then succeeds", async () => {
    // failEvery=2 → 1st generateObject call inside this run fails? No: calls counted per provider instance.
    const registry = new ProviderRegistry([new MockProvider({ latencyMs: 0, failEvery: 2 })]);
    // First call succeeds (1), second fails (2) — run two runs to exercise both paths.
    const first = await runAgent({
      organizationId: orgId,
      agentKey: "test-agent",
      goal: "g",
      input: { topic: "first run" },
      registry,
    });
    expect(first.run.status).toBe("COMPLETED");
    const second = await runAgent({
      organizationId: orgId,
      agentKey: "test-agent",
      goal: "g",
      input: { topic: "second run" },
      registry,
    });
    // The second run's first attempt failed (call #2), retry succeeded (call #3).
    expect(second.run.status).toBe("COMPLETED");
    expect(second.run.attempts).toBe(2);
  });

  it("fails the run and writes an ErrorEvent when retries are exhausted", async () => {
    const registry = new ProviderRegistry([new MockProvider({ latencyMs: 0, failEvery: 1 })]);
    await expect(
      runAgent({
        organizationId: orgId,
        agentKey: "test-agent",
        goal: "g",
        input: { topic: "always fails" },
        registry,
      }),
    ).rejects.toThrow();
    const failed = await prisma.agentRun.findFirst({
      where: { organizationId: orgId, status: "FAILED" },
    });
    expect(failed).not.toBeNull();
    const errorEvents = await prisma.errorEvent.count({
      where: { organizationId: orgId, source: "agent-runner" },
    });
    expect(errorEvents).toBeGreaterThan(0);
  });
});

describe.skipIf(!available)("cost guard (integration)", () => {
  it("enforces hard daily limits", async () => {
    await prisma.costLimit.create({
      data: {
        organizationId: orgId,
        scope: "DAILY",
        scopeKey: "",
        limitMicroUsd: usdToMicro(0.01),
        isHardStop: true,
      },
    });
    await recordCost({
      organizationId: orgId,
      category: "AI_TOKENS",
      costMicroUsd: usdToMicro(0.02),
      description: "test spend",
    });
    await expect(assertWithinCostLimits({ organizationId: orgId })).rejects.toMatchObject({
      code: "COST_LIMIT",
    });
    // A COST_LIMIT_REACHED notification must exist.
    const note = await prisma.notification.findFirst({
      where: { organizationId: orgId, kind: "COST_LIMIT_REACHED" },
    });
    expect(note).not.toBeNull();
    await prisma.costLimit.deleteMany({ where: { organizationId: orgId } });
  });

  it("enforces per-run budgets", async () => {
    await expect(
      assertWithinCostLimits({
        organizationId: orgId,
        runCostMicroUsd: 600_000n,
        runLimitMicroUsd: 500_000n,
      }),
    ).rejects.toMatchObject({ code: "COST_LIMIT" });
  });

  it("throws PlatformError with non-retryable semantics", async () => {
    try {
      await assertWithinCostLimits({
        organizationId: orgId,
        runCostMicroUsd: 2n,
        runLimitMicroUsd: 1n,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).retryable).toBe(false);
    }
  });
});
