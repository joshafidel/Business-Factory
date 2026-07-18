import { prisma, type NotificationKind } from "@bf/database";
import { createLogger } from "@bf/shared";

const log = createLogger("notifications");

export interface NotificationPayload {
  organizationId: string;
  /** null = notify all members with sufficient role (resolved by dispatcher). */
  userId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
}

/**
 * Channel abstraction. IN_APP writes DB rows the dashboard bell reads.
 * EMAIL is a mock that logs and records the send; a real ESP adapter can
 * replace it without touching call sites. Slack/SMS are future channels.
 */
export interface NotificationChannelAdapter {
  readonly channel: "IN_APP" | "EMAIL" | "SLACK" | "SMS";
  send(payload: NotificationPayload): Promise<void>;
}

export class InAppChannel implements NotificationChannelAdapter {
  readonly channel = "IN_APP" as const;

  async send(payload: NotificationPayload): Promise<void> {
    await prisma.notification.create({
      data: {
        organizationId: payload.organizationId,
        userId: payload.userId,
        kind: payload.kind,
        channel: "IN_APP",
        title: payload.title,
        body: payload.body,
        href: payload.href,
        sentAt: new Date(),
      },
    });
  }
}

export class MockEmailChannel implements NotificationChannelAdapter {
  readonly channel = "EMAIL" as const;

  async send(payload: NotificationPayload): Promise<void> {
    // No real email leaves the system. The send is recorded for visibility.
    log.info(
      { organizationId: payload.organizationId, kind: payload.kind, title: payload.title },
      "mock email sent",
    );
    await prisma.notification.create({
      data: {
        organizationId: payload.organizationId,
        userId: payload.userId,
        kind: payload.kind,
        channel: "EMAIL",
        title: `[mock email] ${payload.title}`,
        body: payload.body,
        href: payload.href,
        sentAt: new Date(),
      },
    });
  }
}
