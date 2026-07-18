import {
  agentSuccessRate,
  approvalRate,
  assetsGenerated,
  avgRunDurationMs,
  costByModule,
  costByProvider,
  costOverTime,
  jobsProcessed,
  workflowSuccessRate,
} from "@bf/analytics";
import { prisma } from "@bf/database";
import { formatMicroUsd, microToUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDuration } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;
  const [
    wfRate,
    agRate,
    apRate,
    avgDuration,
    jobs,
    assets,
    byModule,
    byProvider,
    overTime,
    demoMetrics,
  ] = await Promise.all([
    workflowSuccessRate(orgId),
    agentSuccessRate(orgId),
    approvalRate(orgId),
    avgRunDurationMs(orgId),
    jobsProcessed(orgId),
    assetsGenerated(orgId),
    costByModule(orgId),
    costByProvider(orgId),
    costOverTime(orgId),
    prisma.metric.count({ where: { organizationId: orgId, isDemo: true } }),
  ]);

  const pct = (r: { rate: number | null }) =>
    r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Live operational metrics computed from actual run data (30-day window)."
      />
      {demoMetrics > 0 ? (
        <p className="mb-4 rounded-md bg-warning/15 p-2 text-xs text-yellow-800">
          Seeded demo metric rows exist for chart demonstrations; they are flagged isDemo and
          excluded from all numbers on this page.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Workflow success rate" value={pct(wfRate)} sub={`${wfRate.total} runs`} />
        <Stat label="Agent success rate" value={pct(agRate)} sub={`${agRate.total} runs`} />
        <Stat label="Approval rate" value={pct(apRate)} sub={`${apRate.total} decided`} />
        <Stat label="Avg run duration" value={avgDuration ? formatDuration(avgDuration) : "—"} />
        <Stat
          label="Failure rate (workflows)"
          value={wfRate.total > 0 ? `${Math.round((wfRate.failed / wfRate.total) * 100)}%` : "—"}
        />
        <Stat label="Jobs processed" value={jobs} />
        <Stat label="Assets generated" value={assets} />
        <Stat
          label="Avg cost / run"
          value={
            wfRate.total > 0 && overTime.length > 0
              ? formatMicroUsd(
                  overTime.reduce((a, b) => a + b.costMicroUsd, 0n) /
                    BigInt(Math.max(1, wfRate.total)),
                )
              : "—"
          }
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost over time (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={overTime.map((b) => ({ label: b.bucket, value: microToUsd(b.costMicroUsd) }))}
              format={(v) => `$${v.toFixed(2)}`}
              empty="No spend recorded yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost by module (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={byModule.map((m) => ({
                label: m.moduleKey,
                value: microToUsd(m.costMicroUsd),
              }))}
              format={(v) => `$${v.toFixed(2)}`}
              empty="No module spend yet."
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Provider usage (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={byProvider.map((p) => ({
                label: `${p.providerKey} (${p.calls} calls)`,
                value: microToUsd(p.costMicroUsd),
              }))}
              format={(v) => `$${v.toFixed(2)}`}
              empty="No provider calls yet."
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Dependency-free horizontal bar chart for small aggregate sets. */
function BarList({
  rows,
  format,
  empty,
}: {
  rows: { label: string; value: number }[];
  format: (v: number) => string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0.000001);
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label} className="text-xs">
          <div className="mb-0.5 flex justify-between">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium tabular-nums">{format(row.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
