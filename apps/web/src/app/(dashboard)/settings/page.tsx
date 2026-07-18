import { prisma } from "@bf/database";
import { can } from "@bf/shared";
import { getProviderRegistry } from "@bf/providers";
import { requireOrgContext } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { AddMemberForm, RoleSelect } from "./member-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const canManage = can(ctx.role, "members:manage");
  const providers = getProviderRegistry().available();

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Workspace configuration for ${ctx.organizationName}`}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Members & roles</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        joined {formatDate(member.createdAt)}
                      </span>
                      {member.role === "OWNER" || !canManage ? (
                        <Badge variant="primary">{member.role}</Badge>
                      ) : (
                        <RoleSelect memberId={member.id} currentRole={member.role} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI providers</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="mb-2 text-xs text-muted-foreground">
                Providers register automatically when their API key environment variable is set.
                Keys never leave the server.
              </p>
              <ul className="space-y-2">
                {providers.map((p) => (
                  <li key={p.key} className="flex items-center justify-between">
                    <span className="font-medium">{p.key}</span>
                    <span className="text-xs text-muted-foreground">{p.models.join(", ")}</span>
                  </li>
                ))}
              </ul>
              {providers.length === 1 ? (
                <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  Only the mock provider is enabled. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the
                  server to enable real providers.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {canManage ? (
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Add member</CardTitle>
            </CardHeader>
            <CardContent>
              <AddMemberForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
