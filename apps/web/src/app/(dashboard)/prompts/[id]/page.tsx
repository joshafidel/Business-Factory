import { notFound } from "next/navigation";
import { prisma } from "@bf/database";
import { can } from "@bf/shared";
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
import { rollbackPromptAction } from "../actions";
import { EditPromptForm, TestPromptForm } from "./forms";

export const metadata = { title: "Prompt" };

export default async function PromptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext();
  const { id } = await params;
  const prompt = await prisma.prompt.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      versions: {
        orderBy: { version: "desc" },
        include: { _count: { select: { agentRuns: true } } },
      },
      activeVersion: true,
      agentVersions: { include: { agent: { select: { name: true, id: true } } } },
    },
  });
  if (!prompt) notFound();
  const canWrite = can(ctx.role, "prompts:write");
  const active = prompt.activeVersion;

  return (
    <>
      <PageHeader title={prompt.name} description={prompt.description ?? prompt.key}>
        <StatusBadge status={prompt.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active template (v{active?.version ?? "—"})</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {active?.template ?? "No active version"}
              </pre>
              {active && active.variables.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {active.variables.map((v) => (
                    <Badge key={v} variant="primary">
                      {"{{"}
                      {v}
                      {"}}"}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {prompt.versions.map((v) => (
                  <li key={v.id} className="py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">v{v.version}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{v.changelog}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {v._count.agentRuns} runs · {formatDate(v.createdAt)}
                        </span>
                        {v.id === prompt.activeVersionId ? (
                          <Badge variant="success">active</Badge>
                        ) : canWrite ? (
                          <form
                            action={async () => {
                              "use server";
                              await rollbackPromptAction(prompt.id, v.version);
                            }}
                          >
                            <Button variant="outline" size="sm">
                              Roll back to
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Show template
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                        {v.template}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assigned to agents</CardTitle>
            </CardHeader>
            <CardContent>
              {prompt.agentVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not assigned to any agent version.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {[
                    ...new Map(prompt.agentVersions.map((av) => [av.agent.id, av.agent])).values(),
                  ].map((agent) => (
                    <li key={agent.id}>{agent.name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {canWrite ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New version</CardTitle>
              </CardHeader>
              <CardContent>
                <EditPromptForm promptId={prompt.id} currentTemplate={active?.template ?? ""} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Test (mock provider, no spend)</CardTitle>
              </CardHeader>
              <CardContent>
                <TestPromptForm defaultTemplate={active?.template ?? ""} />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
