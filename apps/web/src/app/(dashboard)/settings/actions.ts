"use server";

import { revalidatePath } from "next/cache";
import { prisma, writeAudit, type OrgRole } from "@bf/database";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { assertPermission } from "@/lib/session";

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"]),
  password: z.string().min(10).max(200),
});

/**
 * Local-first member management: creates the user (or reuses an existing one)
 * and adds an org membership. Email invitations arrive when a real email
 * channel replaces the mock.
 */
export async function addMemberAction(formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertPermission("members:manage");
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const { email, name, role, password } = parsed.data;

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      name,
      passwordHash: await bcrypt.hash(password, 12),
    },
    update: {},
  });
  const existing = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: ctx.organizationId, userId: user.id },
    },
  });
  if (existing) return { error: "That user is already a member." };
  await prisma.organizationMember.create({
    data: { organizationId: ctx.organizationId, userId: user.id, role: role as OrgRole },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "member.added",
    entityType: "OrganizationMember",
    detail: { email: email.toLowerCase(), role },
  });
  revalidatePath("/settings");
  return {};
}

export async function changeMemberRoleAction(memberId: string, role: string): Promise<void> {
  const ctx = await assertPermission("members:manage");
  const parsedRole = z.enum(["ADMIN", "OPERATOR", "REVIEWER", "VIEWER"]).safeParse(role);
  if (!parsedRole.success) return;
  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId },
  });
  // Owners cannot be demoted from the UI; ownership transfer is a deliberate,
  // separate operation not exposed yet.
  if (!member || member.role === "OWNER") return;
  await prisma.organizationMember.update({
    where: { id: member.id },
    data: { role: parsedRole.data as OrgRole },
  });
  await writeAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    actorType: "user",
    action: "member.role_changed",
    entityType: "OrganizationMember",
    entityId: member.id,
    detail: { from: member.role, to: parsedRole.data },
  });
  revalidatePath("/settings");
}
