import Link from "next/link";
import { prisma } from "@bf/database";
import { can } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { CreatePromptForm } from "./create-form";

export const metadata = { title: "Prompt Library" };

export default async function PromptsPage() {
  const ctx = await requireOrgContext();
  const prompts = await prisma.prompt.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      activeVersion: true,
      _count: { select: { versions: true, agentVersions: true } },
    },
    orderBy: { name: "asc" },
  });
  const canWrite = can(ctx.role, "prompts:write");

  return (
    <>
      <PageHeader
        title="Prompt Library"
        description="Versioned templates with {{variables}}. Every agent run records the exact version it used."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {prompts.length === 0 ? (
            <EmptyState title="No prompts yet" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Prompt</TH>
                  <TH>Active version</TH>
                  <TH>Versions</TH>
                  <TH>Used by agents</TH>
                  <TH>Status</TH>
                  <TH>Updated</TH>
                </TR>
              </THead>
              <TBody>
                {prompts.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/prompts/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.key}</p>
                    </TD>
                    <TD>v{p.activeVersion?.version ?? "—"}</TD>
                    <TD>{p._count.versions}</TD>
                    <TD>{p._count.agentVersions}</TD>
                    <TD>
                      <StatusBadge status={p.status} />
                    </TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(p.updatedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        {canWrite ? (
          <Card>
            <CardHeader>
              <CardTitle>New prompt</CardTitle>
            </CardHeader>
            <CardContent>
              <CreatePromptForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
