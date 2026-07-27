import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { type z } from "zod";
import { loadConfig } from "../config";
import { type CostTracker } from "../utils/cost";
import { log } from "../utils/log";

/**
 * Claude adapter with automatic mock fallback.
 *
 * Live mode (ANTHROPIC_API_KEY set): structured generation via
 * client.beta.messages.parse + betaZodOutputFormat against ANTHROPIC_MODEL
 * (default claude-opus-5), validated by the same Zod schema the rest of
 * the pipeline uses.
 *
 * Mock mode: returns the hand-authored fixture the call site supplies, so the
 * entire pipeline runs deterministically with zero keys.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** Rough cost estimate for the budget guard (input chars/4 ≈ tokens). */
function estimateUsd(prompt: string, maxTokens: number): number {
  const inputTokens = Math.ceil(prompt.length / 4);
  // claude-opus-5: $5/M input, $25/M output; assume half the output cap is used.
  return (inputTokens * 5) / 1_000_000 + ((maxTokens / 2) * 25) / 1_000_000;
}

export interface GenerateOptions<T> {
  /** What is being generated — used for logs and the cost ledger. */
  item: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Deterministic fixture used when no ANTHROPIC_API_KEY is configured. */
  mock: () => T;
  tracker: CostTracker;
  maxTokens?: number;
}

export async function generateStructured<T>(opts: GenerateOptions<T>): Promise<T> {
  const env = loadConfig();
  const maxTokens = opts.maxTokens ?? 16000;

  if (!env.ANTHROPIC_API_KEY) {
    opts.tracker.charge({ provider: "anthropic", item: opts.item, estimatedUsd: 0, mode: "mock" });
    log.info(`LLM mock: ${opts.item}`);
    return opts.schema.parse(opts.mock());
  }

  opts.tracker.charge({
    provider: "anthropic",
    item: opts.item,
    estimatedUsd: estimateUsd(opts.prompt, maxTokens),
    mode: "live",
  });
  log.info(`LLM live (${env.ANTHROPIC_MODEL}): ${opts.item}`);

  const response = await getClient().beta.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: opts.prompt }],
    output_format: betaZodOutputFormat(opts.schema),
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined to generate "${opts.item}" (stop_reason: refusal). ` +
        `Adjust the prompt/content and retry.`,
    );
  }
  if (response.parsed_output == null) {
    throw new Error(
      `Claude returned unparseable output for "${opts.item}" (stop_reason: ${response.stop_reason}).`,
    );
  }
  return response.parsed_output;
}
