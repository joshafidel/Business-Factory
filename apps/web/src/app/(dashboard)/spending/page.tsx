import { prisma } from "@bf/database";
import { can, formatMicroUsd, microToUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { ensureSpendingRegistry, totalToDateMicroUsd, cyclesElapsed, usageByApp } from "@/lib/spending";
import { Badge, Card, CardContent, PageHeader, Stat } from "@/components/ui";
import { PurchaseItem, type PurchaseItemData } from "./purchase-item";
import { AddPurchaseForm } from "./add-purchase-form";

export const metadata = { title: "Spending" };

const APP_LABELS: Record<string, { emoji: string; name: string }> = {
  "kids-shorts": { emoji: "🦁", name: "Zoo Shorts" },
  "love-villa": { emoji: "🌹", name: "Love Villa: Nations" },
  "listing-video-factory": { emoji: "🎬", name: "Listing Video Factory" },
  platform: { emoji: "🏭", name: "Platform (shared)" },
};

function dateLabel(d: Date | null): string {
  return d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";
}

/**
 * Spending — the owner's money page. Two different kinds of numbers live
 * here, deliberately kept apart:
 *  · Purchases & subscriptions: real dollars that left your pocket
 *    (seeded as estimates until confirmed — editing a line confirms it).
 *  · Metered API usage: what the workflows consumed, drawn AGAINST those
 *    credits/plans — shown for context, never added to the purchase total.
 */
export default async function SpendingPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;
  await ensureSpendingRegistry(orgId);

  const [records, usage] = await Promise.all([
    prisma.purchaseRecord.findMany({
      where: { organizationId: orgId },
      orderBy: [{ kind: "asc" }, { amountMicroUsd: "desc" }],
    }),
    usageByApp(orgId),
  ]);

  const now = new Date();
  const oneTime = records.filter((r) => r.kind === "ONE_TIME");
  const subs = records.filter((r) => r.kind === "SUBSCRIPTION");

  const oneTimeTotal = oneTime.reduce((acc, r) => acc + r.amountMicroUsd, 0n);
  const subsToDate = subs.reduce((acc, r) => acc + totalToDateMicroUsd(r, now), 0n);
  const monthlyRecurring = subs
    .filter((r) => !r.endedAt)
    .reduce(
      (acc, r) => acc + (r.cadence === "annual" ? r.amountMicroUsd / 12n : r.amountMicroUsd),
      0n,
    );
  const outOfPocket = oneTimeTotal + subsToDate;
  const hasEstimates = records.some((r) => r.isEstimate);
  const canManage = can(ctx.role, "costs:manage");

  const toItemData = (r: (typeof records)[number]): PurchaseItemData => {
    const cycles = cyclesElapsed(r, now);
    const perCycle = formatMicroUsd(r.amountMicroUsd);
    const isSub = r.kind === "SUBSCRIPTION";
    return {
      id: r.id,
      kind: r.kind,
      vendor: r.vendor,
      name: r.name,
      amountUsd: microToUsd(r.amountMicroUsd),
      cadence: r.cadence,
      date: (isSub ? r.startedAt : r.purchasedAt)?.toISOString().slice(0, 10) ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      isEstimate: r.isEstimate,
      notes: r.notes,
      amountLabel: isSub ? `${perCycle}/${r.cadence === "annual" ? "yr" : "mo"}` : perCycle,
      totalLabel: isSub
        ? `${perCycle} × ${cycles} ${r.cadence === "annual" ? "year" : "month"}${cycles === 1 ? "" : "s"} = ${formatMicroUsd(totalToDateMicroUsd(r, now))} so far${r.endedAt ? " (cancelled)" : ""}`
        : `One-time purchase on ${dateLabel(r.purchasedAt)}`,
      metaLabel: isSub
        ? `${r.vendor} · since ${dateLabel(r.startedAt)}`
        : `${r.vendor} · ${dateLabel(r.purchasedAt)}`,
    };
  };

  return (
    <>
      <PageHeader
        title="💸 Spending"
        description="Everything these businesses cost you — purchases, subscriptions, and what the AI actually used."
      />

      {hasEstimates ? (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Some amounts are still estimates 👇</p>
            <p className="mt-1 text-muted-foreground">
              I can see every account your sessions set up and what the AI used, but not your
              provider bills. Rows marked <Badge variant="warning">estimate</Badge> are seeded
              from price lists — tap one, hit “Set real amount”, and it becomes confirmed.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label={hasEstimates ? "Out of pocket (≈ estimate)" : "Out of pocket (to date)"}
          value={formatMicroUsd(outOfPocket)}
          sub="one-time + subscriptions so far"
        />
        <Stat
          label="Recurring right now"
          value={`${formatMicroUsd(monthlyRecurring)}/mo`}
          sub="active subscriptions, monthly equivalent"
        />
        <Stat
          label="AI usage — all time"
          value={formatMicroUsd(usage.allTimeMicroUsd)}
          sub="metered against your credits & plans"
        />
        <Stat
          label="AI usage — this month"
          value={formatMicroUsd(usage.monthMicroUsd)}
          sub={`capped at $30/day by the ledger`}
        />
      </div>

      <div className="mt-8 space-y-8">
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">🔁 Recurring subscriptions</h2>
            <span className="text-xs text-muted-foreground">
              {formatMicroUsd(subsToDate)} paid to date
            </span>
          </div>
          <div className="space-y-2">
            {subs.map((r) => (
              <PurchaseItem key={r.id} item={toItemData(r)} canManage={canManage} />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">🎟️ One-time purchases (tokens & credits)</h2>
            <span className="text-xs text-muted-foreground">
              {formatMicroUsd(oneTimeTotal)} total
            </span>
          </div>
          <div className="space-y-2">
            {oneTime.map((r) => (
              <PurchaseItem key={r.id} item={toItemData(r)} canManage={canManage} />
            ))}
            {canManage ? <AddPurchaseForm /> : null}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">⚡ Where the AI usage went</h2>
            <span className="text-xs text-muted-foreground">
              {formatMicroUsd(usage.allTimeMicroUsd)} all time
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            This is what the workflows consumed, drawn against the credits and plans above — it’s
            context, not extra money on top. Detailed per-run records live under Costs.
          </p>
          <div className="space-y-2">
            {usage.lines.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  No metered usage recorded yet.
                </CardContent>
              </Card>
            ) : (
              usage.lines.map((line) => {
                const app = APP_LABELS[line.moduleKey] ?? { emoji: "📁", name: line.moduleKey };
                return (
                  <details key={line.moduleKey} className="group rounded-lg border border-border bg-card">
                    <summary className="flex cursor-pointer select-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                      <span className="text-xl">{app.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{app.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatMicroUsd(line.monthMicroUsd)} this month
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatMicroUsd(line.allTimeMicroUsd)}
                      </span>
                      <svg
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </summary>
                    <ul className="space-y-1.5 border-t border-border p-3 text-sm">
                      {line.providers.map((p) => (
                        <li key={p.providerKey} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{p.providerKey}</span>
                          <span className="tabular-nums">{formatMicroUsd(p.allTimeMicroUsd)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
