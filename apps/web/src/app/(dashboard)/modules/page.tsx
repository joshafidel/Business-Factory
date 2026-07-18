import { prisma } from "@bf/database";
import { moduleManifestSchema } from "@bf/shared";
import { requireOrgContext } from "@/lib/session";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
} from "@/components/ui";

export const metadata = { title: "Business Modules" };

export default async function ModulesPage() {
  const ctx = await requireOrgContext();
  const modules = await prisma.businessModule.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Business Modules"
        description="Each future business installs as an isolated module against the platform's module contract."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((mod) => {
          const manifest = moduleManifestSchema.safeParse(mod.manifest);
          const m = manifest.success ? manifest.data : null;
          return (
            <Card key={mod.id}>
              <CardHeader className="flex-row items-start justify-between">
                <CardTitle>{mod.name}</CardTitle>
                <StatusBadge status={mod.status} />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{mod.description}</p>
                {m ? (
                  <>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Planned workflows</p>
                      <ul className="mt-1 list-inside list-disc text-xs">
                        {m.workflows.map((w) => (
                          <li key={w.key}>{w.name}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Required integrations
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.requiredIntegrations.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          m.requiredIntegrations.map((key) => (
                            <Badge key={key} variant="outline">
                              {key}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Metrics</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.metrics.map((metric) => (
                          <Badge key={metric.key}>{metric.label}</Badge>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-destructive">Invalid manifest</p>
                )}
                {mod.status === "COMING_NEXT" ? (
                  <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                    Coming next — business logic not yet installed. The platform contract, metrics,
                    and integration requirements above are placeholders it will implement.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
