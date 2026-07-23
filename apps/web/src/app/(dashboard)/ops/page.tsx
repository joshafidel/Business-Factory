import Link from "next/link";
import { prisma } from "@bf/database";
import { spendTotals } from "@bf/analytics";
import { getExecutionMode, getWorkerHealth, redisHealthy } from "@bf/queue";
import { formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";

export default async function OverviewPage() {
  const ctx = await requireOrgContext();
  const orgId = ctx.organizationId;

  const [
    activeWorkflows,
    pendingApprovals,
    failedJobs,
    spend,
    recentRuns,
    recentAssets,
    dbOk,
    redisOk,
    workers,
  ] = await Promise.all([
    prisma.workflow.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
    prisma.approvalRequest.count({ where: { organizationId: orgId, status: "PENDING" } }),
    prisma.job.count({ where: { organizationId: orgId, status: { in: ["FAILED", "DEAD"] } } }),
    spendTotals(orgId),
    prisma.agentRun.findMany({
      where: { organizationId: orgId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.asset.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    getExecutionMode() === "inline" ? Promise.resolve(false) : redisHealthy(),
    getExecutionMode() === "inline"
      ? Promise.resolve([])
      : redisHealthy().then((ok) => (ok ? getWorkerHealth() : [])),
  ]);

  const healthyWorkers = workers.filter((w) => w.healthy).length;
  const inlineMode = getExecutionMode() === "inline";

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Operations snapshot for ${ctx.organizationName}`}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active workflows" value={activeWorkflows} />
        <Stat label="Pending approvals" value={pendingApprovals} />
        <Stat label="Failed jobs" value={failedJobs} />
        <Stat
          label="Cost today"
          value={formatMicroUsd(spend.todayMicroUsd)}
          sub={`${formatMicroUsd(spend.monthMicroUsd)} this month`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent agent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <EmptyState
                title="No agent runs yet"
                hint="Run the sample workflow to see activity."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentRuns.map((run) => (
                  <li key={run.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium">{run.agent.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {run.goal.slice(0, 60)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {formatMicroUsd(run.costMicroUsd)}
                      </span>
                      <StatusBadge status={run.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <HealthRow label="Database" ok={dbOk} />
              {inlineMode ? (
                <div className="flex items-center justify-between">
                  <span>Execution</span>
                  <span className="font-medium text-success">inline (serverless)</span>
                </div>
              ) : (
                <HealthRow label="Redis" ok={redisOk} />
              )}
              {inlineMode ? null : (
                <HealthRow
                  label={`Workers (${healthyWorkers}/${workers.length || 0})`}
                  ok={healthyWorkers > 0}
                  warn={workers.length === 0}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent assets</CardTitle>
            </CardHeader>
            <CardContent>
              {recentAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assets yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {recentAssets.map((asset) => (
                    <li key={asset.id} className="flex items-center justify-between gap-2">
                      <Link href="/assets" className="truncate hover:underline">
                        {asset.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(asset.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function HealthRow({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span
        className={
          warn
            ? "text-warning font-medium"
            : ok
              ? "text-success font-medium"
              : "text-destructive font-medium"
        }
      >
        {warn ? "none running" : ok ? "healthy" : "down"}
      </span>
    </div>
  );
}
