import { cache } from "react";
import { prisma } from "@bf/database";
import { can, type Permission, type Role } from "@bf/shared";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PlatformError } from "@bf/shared";

export interface OrgContext {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

/**
 * Resolve the signed-in user's organization context. Every server component,
 * server action, and API route goes through this — org scoping and RBAC are
 * enforced here, in one place.
 *
 * Multi-org users get their first membership for now; an org switcher can
 * set a cookie later without changing call sites.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { organization: true, user: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  return {
    userId: membership.userId,
    userName: membership.user.name,
    userEmail: membership.user.email,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    role: membership.role as Role,
  };
});

/** For pages: redirect to sign-in when unauthenticated. */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}

/** For pages: also require a permission, else send to the overview page. */
export async function requirePermission(permission: Permission): Promise<OrgContext> {
  const ctx = await requireOrgContext();
  if (!can(ctx.role, permission)) redirect("/");
  return ctx;
}

/** For server actions / API routes: throw instead of redirect. */
export async function assertPermission(permission: Permission): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new PlatformError("PERMISSION_DENIED", "Not signed in");
  if (!can(ctx.role, permission)) {
    throw new PlatformError("PERMISSION_DENIED", `Missing permission: ${permission}`);
  }
  return ctx;
}
