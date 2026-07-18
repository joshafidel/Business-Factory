import { prisma } from "@bf/database";
import { createLogger } from "@bf/shared";
import {
  InAppChannel,
  MockEmailChannel,
  type NotificationChannelAdapter,
  type NotificationPayload,
} from "./channels";

const log = createLogger("notifications:dispatcher");

const DEFAULT_CHANNELS: NotificationChannelAdapter[] = [new InAppChannel(), new MockEmailChannel()];

/**
 * Dispatch a notification. When userId is null, it fans out to every member
 * whose role should care (reviewers+ for approvals, admins+ for cost events,
 * everyone for the rest). Channel failures are logged, never thrown — a
 * broken notifier must not fail a workflow.
 */
export async function notify(
  payload: NotificationPayload,
  channels: NotificationChannelAdapter[] = DEFAULT_CHANNELS,
): Promise<void> {
  const targets: (string | null)[] = [];
  if (payload.userId) {
    targets.push(payload.userId);
  } else {
    const minRoles: Record<string, string[]> = {
      APPROVAL_REQUIRED: ["OWNER", "ADMIN", "REVIEWER"],
      COST_WARNING: ["OWNER", "ADMIN"],
      COST_LIMIT_REACHED: ["OWNER", "ADMIN"],
      INTEGRATION_FAILURE: ["OWNER", "ADMIN"],
    };
    const roles = minRoles[payload.kind] ?? ["OWNER", "ADMIN", "OPERATOR", "REVIEWER"];
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: payload.organizationId, role: { in: roles as never } },
      select: { userId: true },
    });
    targets.push(...members.map((m) => m.userId));
    if (targets.length === 0) targets.push(null);
  }

  for (const channel of channels) {
    for (const userId of targets) {
      try {
        await channel.send({ ...payload, userId });
      } catch (err) {
        log.error({ err, kind: payload.kind, channel: channel.channel }, "notification failed");
      }
    }
  }
}
