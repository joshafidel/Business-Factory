/**
 * Cost tables in micro-USD per 1M tokens (i.e. the value equals USD-per-token
 * × 10^12 / 10^6 — practically: microUsdPerMTok / 1e6 = $/token).
 * Estimates only; real invoices come from the provider. Unknown models fall
 * back to a conservative default so cost limits still bind.
 */
interface ModelCost {
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

const COSTS: Record<string, ModelCost> = {
  // Mock models are free but report fake token counts for pipeline testing.
  "mock-basic": { inputMicroUsdPerMTok: 0, outputMicroUsdPerMTok: 0 },
  "mock-advanced": { inputMicroUsdPerMTok: 0, outputMicroUsdPerMTok: 0 },
  // Anthropic (USD per MTok: sonnet 3/15, haiku 0.80/4, opus 15/75)
  "claude-sonnet-4-5": { inputMicroUsdPerMTok: 3_000_000, outputMicroUsdPerMTok: 15_000_000 },
  "claude-haiku-4-5": { inputMicroUsdPerMTok: 1_000_000, outputMicroUsdPerMTok: 5_000_000 },
  "claude-opus-4-1": { inputMicroUsdPerMTok: 15_000_000, outputMicroUsdPerMTok: 75_000_000 },
  // OpenAI
  "gpt-4o": { inputMicroUsdPerMTok: 2_500_000, outputMicroUsdPerMTok: 10_000_000 },
  "gpt-4o-mini": { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 },
};

const FALLBACK: ModelCost = { inputMicroUsdPerMTok: 15_000_000, outputMicroUsdPerMTok: 75_000_000 };

export function estimateCostMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): bigint {
  const cost = COSTS[model] ?? FALLBACK;
  const micro =
    (inputTokens * cost.inputMicroUsdPerMTok) / 1_000_000 +
    (outputTokens * cost.outputMicroUsdPerMTok) / 1_000_000;
  return BigInt(Math.ceil(micro));
}

export function knownModels(): string[] {
  return Object.keys(COSTS);
}
