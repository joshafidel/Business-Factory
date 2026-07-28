import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { can, formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate, formatDuration } from "@/lib/utils";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { AssetPreview } from "@/components/asset-preview";
import { cancelRunAction } from "./actions";

export const metadata = { title: "Run" };

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const run = await prisma.workflowRun.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      workflow: true,
      workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } },
      stepRuns: { orderBy: { createdAt: "asc" }, include: { agentRun: true } },
      approvals: {
        include: { decisions: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
      assets: true,
    },
  });
  if (!run) notFound();
  const active = !["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);

  return (
    <>
      <PageHeader
        title={`Run ${run.id.slice(-12)}`}
        description={`${run.workflow.name} · v${run.workflowVersion.version}`}
      >
        <StatusBadge status={run.status} />
        {active && can(ctx.role, "workflows:execute") ? (
          <form
            action={async () => {
              "use server";
              await cancelRunAction(run.id);
            }}
          >
            <Button variant="destructive" size="sm">
              Cancel run
            </Button>
          </form>
        ) : null}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Cost" value={formatMicroUsd(run.costMicroUsd)} />
        <MiniStat
          label="Duration"
          value={
            run.startedAt
              ? formatDuration((run.finishedAt ?? new Date()).getTime() - run.startedAt.getTime())
              : "—"
          }
        />
        <MiniStat
          label="Steps completed"
          value={`${run.stepRuns.filter((s) => s.status === "COMPLETED").length}/${run.workflowVersion.steps.length}`}
        />
        <MiniStat label="Started" value={formatDate(run.startedAt)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-sm font-semibold">Steps</h2>
          {run.workflowVersion.steps.map((step, i) => {
            const attempts = run.stepRuns.filter((sr) => sr.workflowStepId === step.id);
            const latest = attempts[attempts.length - 1];
            return (
              <Card key={step.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{step.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {step.type.replaceAll("_", " ")}
                        {attempts.length > 1 ? ` · ${attempts.length} attempts` : ""}
                        {latest?.costMicroUsd && latest.costMicroUsd > 0n
                          ? ` · ${formatMicroUsd(latest.costMicroUsd)}`
                          : ""}
                      </p>
                    </div>
                    <StatusBadge status={latest?.status ?? "PENDING"} />
                  </div>
                  {latest?.output != null ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Output
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(latest.output, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {latest?.error != null ? (
                    <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                      {JSON.stringify(latest.error, null, 2)}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
                {JSON.stringify(run.input, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {run.error != null ? (
            <Card>
              <CardHeader>
                <CardTitle>Error</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-48 overflow-auto rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {JSON.stringify(run.error, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Approval history</CardTitle>
            </CardHeader>
            <CardContent>
              {run.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approvals for this run.</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {run.approvals.map((appr) => (
                    <li key={appr.id}>
                      <div className="flex items-center justify-between">
                        <Link
                          href={`/approvals/${appr.id}`}
                          className="font-medium hover:underline"
                        >
                          {appr.title}
                        </Link>
                        <StatusBadge status={appr.status} />
                      </div>
                      {appr.decisions.map((d) => (
                        <p key={d.id} className="mt-1 text-xs text-muted-foreground">
                          {d.decision.replaceAll("_", " ").toLowerCase()} by {d.user.name}
                          {d.comment ? ` — “${d.comment}”` : ""}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Generated assets</CardTitle>
            </CardHeader>
            <CardContent>
              {run.assets.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <div className="space-y-3">
                  {run.assets.map((asset) => (
                    <AssetPreview key={asset.id} asset={asset} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
