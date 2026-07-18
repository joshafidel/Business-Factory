import { type Prisma } from "@prisma/client";
import { prisma } from "./client";

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  actorType: "user" | "agent" | "system" | "workflow";
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Write an audit log row. Never throws — an audit failure must not take down
 * the action being audited — but it does log loudly.
 */
export async function writeAudit(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
  try {
    await (tx ?? prisma).auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId ?? null,
        actorType: entry.actorType,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        detail: entry.detail,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", entry.action, err);
  }
}
