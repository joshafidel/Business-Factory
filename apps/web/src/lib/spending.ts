import { prisma } from "@bf/database";
import type { PurchaseRecord } from "@bf/database";

/**
 * Spending registry — the owner's real-money ledger, distinct from the
 * CostRecord usage meter (which tracks API spend drawn AGAINST these
 * purchases, so the two are never summed together).
 *
 * Seeded lazily with every provider account the Claude sessions set up for
 * these businesses. Seeded amounts are best-effort ESTIMATES from provider
 * price lists (isEstimate=true) — the owner confirms real amounts from the
 * Spending page. Seeding uses createMany+skipDuplicates keyed on
 * (organizationId, key), so it NEVER overwrites owner edits.
 */

/** Subscriptions started when the project did (first migration: 2026-07-18). */
const PROJECT_START = new Date("2026-07-18T00:00:00Z");

const SEED_ITEMS: Array<{
  key: string;
  kind: "ONE_TIME" | "SUBSCRIPTION";
  vendor: string;
  name: string;
  amountUsd: number;
  cadence?: "monthly" | "annual";
  notes: string;
}> = [
  // ── Recurring subscriptions ──────────────────────────────────────────────
  {
    key: "claude-subscription",
    kind: "SUBSCRIPTION",
    vendor: "Anthropic",
    name: "Claude plan (runs all the Claude sessions)",
    amountUsd: 100,
    cadence: "monthly",
    notes:
      "Estimate. Pro is $20/mo; Max is $100 or $200/mo. Tap Edit and set the plan you actually pay for.",
  },
  {
    key: "elevenlabs-subscription",
    kind: "SUBSCRIPTION",
    vendor: "ElevenLabs",
    name: "ElevenLabs voice plan (Love Villa voices, narration)",
    amountUsd: 22,
    cadence: "monthly",
    notes:
      "Estimate at the Creator tier ($22/mo) the setup docs recommend. Starter is $5/mo — edit to match your plan.",
  },
  {
    key: "higgsfield-subscription",
    kind: "SUBSCRIPTION",
    vendor: "Higgsfield",
    name: "Higgsfield plan (image-to-video motion)",
    amountUsd: 29,
    cadence: "monthly",
    notes:
      "Estimate — the account allows 4 concurrent render jobs. Edit to your actual tier; set $0 if you're on a free plan.",
  },
  {
    key: "vercel-hosting",
    kind: "SUBSCRIPTION",
    vendor: "Vercel",
    name: "Vercel hosting (this dashboard + all apps)",
    amountUsd: 0,
    cadence: "monthly",
    notes: "Hobby tier is free. If you upgraded to Pro it's $20/mo — edit if so.",
  },
  {
    key: "neon-postgres",
    kind: "SUBSCRIPTION",
    vendor: "Neon",
    name: "Neon Postgres (shared 512MB database)",
    amountUsd: 0,
    cadence: "monthly",
    notes: "Free tier. Becomes ~$19/mo only if upgraded for more storage.",
  },
  // ── One-time purchases (credit top-ups) ──────────────────────────────────
  {
    key: "anthropic-api-credits",
    kind: "ONE_TIME",
    vendor: "Anthropic",
    name: "Claude API credits (scripts & agents)",
    amountUsd: 5,
    notes:
      "Estimate — minimum top-up is $5. Check console.anthropic.com → Billing for what you actually loaded, then edit.",
  },
  {
    key: "openai-api-credits",
    kind: "ONE_TIME",
    vendor: "OpenAI",
    name: "OpenAI API credits (images, TTS voices, visual QA)",
    amountUsd: 10,
    notes:
      "Estimate — typical first top-up is $10. Check platform.openai.com → Billing for the real amount, then edit.",
  },
  {
    key: "fal-credits",
    kind: "ONE_TIME",
    vendor: "fal.ai",
    name: "fal.ai credits (Love Villa animation: Kling / Hailuo)",
    amountUsd: 10,
    notes:
      "Estimate — check fal.ai/dashboard/billing for the real top-up amount, then edit.",
  },
  {
    key: "picsart-credits",
    kind: "ONE_TIME",
    vendor: "Picsart",
    name: "Picsart GenAI credits (listing video motion)",
    amountUsd: 0,
    notes:
      "No valid dev key yet (Listing Factory is waiting on one), so likely nothing spent. Edit when you buy credits.",
  },
];

/** Idempotent: inserts missing registry rows, never touches existing ones. */
export async function ensureSpendingRegistry(organizationId: string): Promise<void> {
  await prisma.purchaseRecord.createMany({
    data: SEED_ITEMS.map((item) => ({
      organizationId,
      key: item.key,
      kind: item.kind,
      vendor: item.vendor,
      name: item.name,
      amountMicroUsd: BigInt(Math.round(item.amountUsd * 1_000_000)),
      cadence: item.cadence ?? null,
      startedAt: item.kind === "SUBSCRIPTION" ? PROJECT_START : null,
      purchasedAt: item.kind === "ONE_TIME" ? PROJECT_START : null,
      isEstimate: true,
      notes: item.notes,
    })),
    skipDuplicates: true,
  });
}

/** Whole billing cycles elapsed (a cycle is charged when it starts). */
export function cyclesElapsed(record: PurchaseRecord, now = new Date()): number {
  if (record.kind !== "SUBSCRIPTION" || !record.startedAt) return 1;
  const end = record.endedAt && record.endedAt < now ? record.endedAt : now;
  if (end < record.startedAt) return 0;
  const days = (end.getTime() - record.startedAt.getTime()) / 86_400_000;
  const cycleDays = record.cadence === "annual" ? 365.25 : 30.44;
  return Math.floor(days / cycleDays) + 1;
}

/** Total paid to date for a record (one-time amount, or price × cycles). */
export function totalToDateMicroUsd(record: PurchaseRecord, now = new Date()): bigint {
  if (record.kind === "ONE_TIME") return record.amountMicroUsd;
  return record.amountMicroUsd * BigInt(cyclesElapsed(record, now));
}

export interface UsageLine {
  moduleKey: string;
  allTimeMicroUsd: bigint;
  monthMicroUsd: bigint;
  providers: Array<{ providerKey: string; allTimeMicroUsd: bigint }>;
}

/** All-time + this-month metered API usage, grouped app → provider. */
export async function usageByApp(organizationId: string): Promise<{
  lines: UsageLine[];
  allTimeMicroUsd: bigint;
  monthMicroUsd: bigint;
}> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [allTime, month] = await Promise.all([
    prisma.costRecord.groupBy({
      by: ["moduleKey", "providerKey"],
      where: { organizationId, isDemo: false },
      _sum: { costMicroUsd: true },
    }),
    prisma.costRecord.groupBy({
      by: ["moduleKey"],
      where: { organizationId, isDemo: false, createdAt: { gte: monthStart } },
      _sum: { costMicroUsd: true },
    }),
  ]);

  const monthByModule = new Map<string, bigint>();
  for (const row of month) {
    monthByModule.set(row.moduleKey ?? "platform", row._sum.costMicroUsd ?? 0n);
  }

  const byModule = new Map<string, UsageLine>();
  for (const row of allTime) {
    const moduleKey = row.moduleKey ?? "platform";
    const line = byModule.get(moduleKey) ?? {
      moduleKey,
      allTimeMicroUsd: 0n,
      monthMicroUsd: monthByModule.get(moduleKey) ?? 0n,
      providers: [],
    };
    const sum = row._sum.costMicroUsd ?? 0n;
    line.allTimeMicroUsd += sum;
    line.providers.push({ providerKey: row.providerKey ?? "other", allTimeMicroUsd: sum });
    byModule.set(moduleKey, line);
  }

  // Merge duplicate provider rows (null moduleKey groups) and sort big-first.
  const lines = [...byModule.values()].map((line) => {
    const merged = new Map<string, bigint>();
    for (const p of line.providers) {
      merged.set(p.providerKey, (merged.get(p.providerKey) ?? 0n) + p.allTimeMicroUsd);
    }
    return {
      ...line,
      providers: [...merged.entries()]
        .map(([providerKey, allTimeMicroUsd]) => ({ providerKey, allTimeMicroUsd }))
        .sort((a, b) => (b.allTimeMicroUsd > a.allTimeMicroUsd ? 1 : -1)),
    };
  });
  lines.sort((a, b) => (b.allTimeMicroUsd > a.allTimeMicroUsd ? 1 : -1));

  const allTimeTotal = lines.reduce((acc, l) => acc + l.allTimeMicroUsd, 0n);
  const monthTotal = [...monthByModule.values()].reduce((acc, v) => acc + v, 0n);
  return { lines, allTimeMicroUsd: allTimeTotal, monthMicroUsd: monthTotal };
}
