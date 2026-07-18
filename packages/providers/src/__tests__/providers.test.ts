import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "@bf/shared";
import { MockProvider } from "../mock";
import { estimateCostMicroUsd } from "../costs";
import { normalizeHttpError } from "../types";
import { ProviderRegistry } from "../registry";

describe("MockProvider", () => {
  const provider = new MockProvider({ latencyMs: 0 });

  it("generates schema-valid structured output", async () => {
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        keyPoints: { type: "array", items: { type: "string" }, minItems: 2 },
        score: { type: "integer", minimum: 0, maximum: 100 },
        verdict: { type: "string", enum: ["pass", "revise"] },
      },
      required: ["summary", "keyPoints", "score", "verdict"],
    };
    const result = await provider.generateObject({
      model: "mock-basic",
      messages: [{ role: "user", content: "topic: gardening" }],
      schema,
    });
    expect(validateJsonSchema(schema, result.object)).toEqual([]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("is deterministic for identical input", async () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const params = {
      model: "mock-basic",
      messages: [{ role: "user" as const, content: "same input" }],
      schema,
    };
    const [r1, r2] = [await provider.generateObject(params), await provider.generateObject(params)];
    expect(r1.object).toEqual(r2.object);
  });

  it("simulates retryable failures when configured", async () => {
    const flaky = new MockProvider({ latencyMs: 0, failEvery: 1 });
    await expect(
      flaky.generateText({ model: "mock-basic", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("streams text chunks", async () => {
    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      model: "mock-basic",
      messages: [{ role: "user", content: "stream me" }],
    })) {
      if (chunk.type === "text") chunks.push(chunk.delta);
    }
    expect(chunks.join("")).toContain("mock");
  });
});

describe("cost estimation", () => {
  it("prices known models", () => {
    // claude-sonnet: $3/MTok in, $15/MTok out.
    expect(estimateCostMicroUsd("claude-sonnet-4-5", 1_000_000, 0)).toBe(3_000_000n);
    expect(estimateCostMicroUsd("claude-sonnet-4-5", 0, 1_000_000)).toBe(15_000_000n);
    expect(estimateCostMicroUsd("mock-basic", 100_000, 100_000)).toBe(0n);
  });

  it("falls back conservatively for unknown models", () => {
    expect(estimateCostMicroUsd("mystery-model", 1_000_000, 0)).toBe(15_000_000n);
  });
});

describe("error normalization", () => {
  it("maps status codes", () => {
    expect(normalizeHttpError("openai", 429, "").code).toBe("PROVIDER_RATE_LIMIT");
    expect(normalizeHttpError("openai", 429, "").retryable).toBe(true);
    expect(normalizeHttpError("openai", 500, "").retryable).toBe(true);
    expect(normalizeHttpError("openai", 401, "").retryable).toBe(false);
  });
});

describe("ProviderRegistry", () => {
  it("always exposes the mock provider and rejects unknown keys", () => {
    const registry = new ProviderRegistry([]);
    expect(registry.get("mock").key).toBe("mock");
    expect(() => registry.get("anthropic")).toThrow(/not enabled/);
  });
});
