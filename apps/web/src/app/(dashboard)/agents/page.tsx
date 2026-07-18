import Link from "next/link";
import { prisma } from "@bf/database";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import {
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

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const ctx = await requireOrgContext();
  const agents = await prisma.agent.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      activeVersion: true,
      module: { select: { name: true } },
      _count: { select: { runs: true, versions: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Agents"
        description="Bounded, versioned AI workers. Each run has a goal, budget, schema-validated I/O, and tool permissions."
      />
      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          hint="Seed the database to create the sample content agents."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Agent</TH>
              <TH>Role</TH>
              <TH>Module</TH>
              <TH>Provider / model</TH>
              <TH>Version</TH>
              <TH>Runs</TH>
              <TH>Status</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {agents.map((agent) => (
              <TR key={agent.id}>
                <TD>
                  <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">
                    {agent.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{agent.key}</p>
                </TD>
                <TD>{agent.role}</TD>
                <TD>{agent.module?.name ?? "Platform"}</TD>
                <TD className="text-xs">
                  {agent.activeVersion
                    ? `${agent.activeVersion.provider} / ${agent.activeVersion.model}`
                    : "—"}
                </TD>
                <TD>
                  v{agent.activeVersion?.version ?? "—"}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({agent._count.versions})
                  </span>
                </TD>
                <TD>{agent._count.runs}</TD>
                <TD>
                  <StatusBadge status={agent.status} />
                </TD>
                <TD className="text-xs text-muted-foreground">{formatDate(agent.updatedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
