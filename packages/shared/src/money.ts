/**
 * All monetary amounts are stored as integer micro-USD (1 USD = 1_000_000).
 * This keeps accumulation exact and comparisons with limits trivial.
 */
export const MICRO_USD_PER_USD = 1_000_000n;

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function microToUsd(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

export function formatMicroUsd(micro: bigint, opts?: { compact?: boolean }): string {
  const usd = microToUsd(micro);
  if (opts?.compact && usd >= 1000) {
    return `$${(usd / 1000).toFixed(1)}k`;
  }
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: usd < 0.1 && usd > 0 ? 4 : 2,
  });
}
