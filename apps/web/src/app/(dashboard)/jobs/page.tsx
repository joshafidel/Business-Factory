import { prisma } from "@bf/database";
import { getWorkerHealth, queueCounts, redisHealthy } from "@bf/queue";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata = { title: "Jobs & Queues" };
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const ctx = await requireOrgContext();
  const redisOk = await redisHealthy();
  const emptyCounts: Awaited<ReturnType<typeof queueCounts>> = {};
  const [counts, workers, jobs] = await Promise.all([
    redisOk ? queueCounts() : Promise.resolve(emptyCounts),
    redisOk ? getWorkerHealth() : Promise.resolve([]),
    prisma.job.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const totals = Object.values(counts).reduce(
    (acc, c) => ({
      waiting: acc.waiting + c.waiting + c.delayed,
      active: acc.active + c.active,
      failed: acc.failed + c.failed,
      completed: acc.completed + c.completed,
    }),
    { waiting: 0, active: 0, failed: 0, completed: 0 },
  );

  return (
    <>
      <PageHeader
        title="Jobs & Queues"
        description="Live queue state, job history, and worker health."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active" value={totals.active} />
        <Stat label="Waiting / delayed" value={totals.waiting} />
        <Stat label="Failed (in queue)" value={totals.failed} />
        <Stat label="Completed (24h retained)" value={totals.completed} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Queues</CardTitle>
          </CardHeader>
          <CardContent>
            {!redisOk ? (
              <p className="text-sm text-destructive">
                Redis unreachable — queue state unavailable.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {Object.entries(counts).map(([name, c]) => (
                  <li key={name} className="flex items-center justify-between py-2">
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.active} active · {c.waiting} waiting · {c.delayed} delayed · {c.failed}{" "}
                      failed
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workers</CardTitle>
          </CardHeader>
          <CardContent>
            {workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No workers seen. Start one with{" "}
                <code className="rounded bg-muted px-1">pnpm dev:worker</code>.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {workers.map((w) => (
                  <li key={w.workerId} className="flex items-center justify-between py-2">
                    <span className="font-mono text-xs">{w.workerId}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        last beat {formatDate(w.lastBeatAt)}
                      </span>
                      <Badge variant={w.healthy ? "success" : "destructive"}>
                        {w.healthy ? "healthy" : "stale"}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Recent jobs</h2>
      {jobs.length === 0 ? (
        <EmptyState title="No jobs recorded yet" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Job</TH>
              <TH>Queue</TH>
              <TH>Attempts</TH>
              <TH>Priority</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH>Finished</TH>
            </TR>
          </THead>
          <TBody>
            {jobs.map((job) => (
              <TR key={job.id}>
                <TD className="font-mono text-xs">{job.name}</TD>
                <TD>{job.queue}</TD>
                <TD>
                  {job.attempts}/{job.maxAttempts}
                </TD>
                <TD>{job.priority}</TD>
                <TD>
                  <StatusBadge status={job.status} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</TD>
                <TD className="text-xs text-muted-foreground">{formatDate(job.finishedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
