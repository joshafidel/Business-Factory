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
import { testConnectionAction } from "./actions";
import { SecretForm } from "./secret-form";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await requireOrgContext();
  const integrations = await prisma.integration.findMany({
    where: { organizationId: ctx.organizationId },
    include: { secrets: { select: { key: true, source: true, maskedPreview: true } } },
    orderBy: { name: "asc" },
  });
  const canManage = can(ctx.role, "integrations:manage");

  return (
    <>
      <PageHeader
        title="Integrations"
        description="External services the business modules will use. Secrets are env references or AES-256-GCM encrypted — never stored or displayed raw."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardHeader className="flex-row items-start justify-between">
              <CardTitle>{integration.name}</CardTitle>
              <StatusBadge status={integration.status} />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{integration.description}</p>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Credentials</p>
                {integration.secrets.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">None configured</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {integration.secrets.map((s) => (
                      <li key={s.key} className="flex items-center justify-between text-xs">
                        <span className="font-mono">{s.key}</span>
                        <Badge variant="outline">{s.maskedPreview ?? s.source}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {integration.lastCheckedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last checked {formatDate(integration.lastCheckedAt)}
                  {integration.lastError ? ` — ${integration.lastError}` : " — OK"}
                </p>
              ) : null}
              {canManage ? (
                <div className="space-y-3 border-t border-border pt-3">
                  <form
                    action={async () => {
                      "use server";
                      await testConnectionAction(integration.id);
                    }}
                  >
                    <Button variant="outline" size="sm" className="w-full">
                      Test connection
                    </Button>
                  </form>
                  <SecretForm integrationId={integration.id} />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
