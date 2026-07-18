import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { can, formatMicroUsd } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { RunWorkflowForm } from "./run-form";
import { setWorkflowStatusAction } from "../actions";

export const metadata = { title: "Workflow" };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const workflow = await prisma.workflow.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      module: true,
      activeVersion: { include: { steps: { orderBy: { order: "asc" } } } },
      runs: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!workflow) notFound();
  const canExecute = can(ctx.role, "workflows:execute");
  const canWrite = can(ctx.role, "workflows:write");

  return (
    <>
      <PageHeader title={workflow.name} description={workflow.description}>
        <StatusBadge status={workflow.status} />
        {canWrite ? (
          workflow.status === "ACTIVE" ? (
            <form
              action={async () => {
                "use server";
                await setWorkflowStatusAction(workflow.id, "PAUSED");
              }}
            >
              <Button variant="outline" size="sm">
                Pause
              </Button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                await setWorkflowStatusAction(workflow.id, "ACTIVE");
              }}
            >
              <Button variant="success" size="sm">
                Activate
              </Button>
            </form>
          )
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Steps (version {workflow.activeVersion?.version ?? "—"})</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {(workflow.activeVersion?.steps ?? []).map((step, i) => (
                <li
                  key={step.id}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{step.name}</p>
                    <p className="text-xs text-muted-foreground">{step.key}</p>
                  </div>
                  <Badge
                    variant={
                      step.type === "HUMAN_APPROVAL" || step.type === "PUBLISH"
                        ? "warning"
                        : "default"
                    }
                  >
                    {step.type.replaceAll("_", " ")}
                  </Badge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Module</span>
                <span>{workflow.module?.name ?? "Platform"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trigger</span>
                <span>{workflow.triggerType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost limit / run</span>
                <span>{formatMicroUsd(workflow.costLimitMicroUsd)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Input schema</span>
              </div>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
                {JSON.stringify(workflow.activeVersion?.inputSchema ?? {}, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {canExecute && workflow.status === "ACTIVE" ? (
            <Card>
              <CardHeader>
                <CardTitle>Run this workflow</CardTitle>
              </CardHeader>
              <CardContent>
                <RunWorkflowForm workflowKey={workflow.key} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold">Recent runs</h2>
      <div className="space-y-2">
        {workflow.runs.map((run) => (
          <Link
            key={run.id}
            href={`/runs/${run.id}`}
            className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm hover:bg-muted/40"
          >
            <span className="font-mono text-xs">{run.id}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {formatMicroUsd(run.costMicroUsd)}
              </span>
              <span className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</span>
              <StatusBadge status={run.status} />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
