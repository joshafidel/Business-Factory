import { validateJsonSchema } from "@bf/shared";
import {
  type AIProvider,
  type GenerateObjectParams,
  type GenerateObjectResult,
  type GenerateTextParams,
  type GenerateTextResult,
  type StreamChunk,
  type Usage,
} from "./types";

/**
 * Deterministic local provider used whenever real API keys are absent and in
 * all tests. It is schema-aware: generateObject synthesizes output that
 * actually satisfies the requested JSON Schema, so downstream validation and
 * the whole workflow pipeline run exactly as they would with a real model.
 */
export class MockProvider implements AIProvider {
  readonly key = "mock";
  readonly models = ["mock-basic", "mock-advanced"];

  constructor(private readonly opts: { latencyMs?: number; failEvery?: number } = {}) {}

  private calls = 0;

  private async simulate(): Promise<void> {
    this.calls += 1;
    if (this.opts.failEvery && this.calls % this.opts.failEvery === 0) {
      const { ProviderError } = await import("./types");
      throw new ProviderError("PROVIDER_ERROR", "mock: simulated transient failure", {
        retryable: true,
      });
    }
    const latency = this.opts.latencyMs ?? 50;
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
  }

  private usageFor(input: string, output: string): Usage {
    return {
      inputTokens: Math.max(1, Math.ceil(input.length / 4)),
      outputTokens: Math.max(1, Math.ceil(output.length / 4)),
    };
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    await this.simulate();
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
    const topic = (lastUser?.content ?? "the requested topic").slice(0, 200);
    const text = [
      `[mock:${params.model}] Draft response.`,
      ``,
      `This is deterministic mock output produced without any external API call.`,
      `It responds to: ${topic}`,
    ].join("\n");
    return {
      text,
      toolCalls: [],
      usage: this.usageFor(JSON.stringify(params.messages), text),
      stopReason: "end",
    };
  }

  async generateObject(params: GenerateObjectParams): Promise<GenerateObjectResult> {
    await this.simulate();
    const seedSource = params.messages.map((m) => m.content).join("|");
    const object = synthesizeFromSchema(params.schema, seedFrom(seedSource));
    const errors = validateJsonSchema(params.schema, object);
    if (errors.length > 0) {
      // Should never happen; guards against schema features the synthesizer misses.
      throw new Error(`MockProvider produced invalid object: ${errors.join("; ")}`);
    }
    return {
      object,
      usage: this.usageFor(seedSource, JSON.stringify(object)),
    };
  }

  async *streamText(params: GenerateTextParams): AsyncIterable<StreamChunk> {
    const result = await this.generateText(params);
    for (const word of result.text.split(/(?<=\s)/)) {
      yield { type: "text", delta: word };
    }
    yield { type: "usage", usage: result.usage };
    yield { type: "done" };
  }
}

/** Small deterministic PRNG so mock output is stable for identical input. */
function seedFrom(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const SAMPLE_SENTENCES = [
  "Focus on a single clear takeaway per section.",
  "Audience research suggests strong interest in practical examples.",
  "Keep the tone friendly, concrete, and jargon-free.",
  "Add a short summary at the end reinforcing the main point.",
  "Use vivid, specific language rather than generic claims.",
];

function synthesizeFromSchema(schema: Record<string, unknown>, rand: () => number): unknown {
  const type = schema.type as string | undefined;
  if (type === "object") {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(props)) {
      out[key] = synthesizeFromSchema(sub, rand);
    }
    return out;
  }
  if (type === "array") {
    const items = (schema.items ?? { type: "string" }) as Record<string, unknown>;
    const min = (schema.minItems as number | undefined) ?? 2;
    const count = Math.max(min, 2 + Math.floor(rand() * 2));
    return Array.from({ length: count }, () => synthesizeFromSchema(items, rand));
  }
  if (type === "string") {
    const enumVals = schema.enum as string[] | undefined;
    if (enumVals && enumVals.length > 0) {
      return enumVals[Math.floor(rand() * enumVals.length)];
    }
    const idx = Math.floor(rand() * SAMPLE_SENTENCES.length);
    return SAMPLE_SENTENCES[idx];
  }
  if (type === "number") {
    const min = (schema.minimum as number | undefined) ?? 0;
    const max = (schema.maximum as number | undefined) ?? 100;
    return Math.round((min + rand() * (max - min)) * 100) / 100;
  }
  if (type === "integer") {
    const min = (schema.minimum as number | undefined) ?? 0;
    const max = (schema.maximum as number | undefined) ?? 100;
    return Math.floor(min + rand() * (max - min + 1));
  }
  if (type === "boolean") return rand() > 0.3;
  return null;
}
