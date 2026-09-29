import { Injectable, NotFoundException } from "@nestjs/common";
import type { Notification } from "../../generated/prisma/client";
import { AuditService } from "../../common/audit/audit.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { PrismaService } from "../../platform/database/prisma.service";
import { MailService } from "../../platform/mail/mail.service";
import type { CreateNotificationDto, NotificationResponseDto } from "./dto/notification.dto";

function publicNotification(value: Notification): NotificationResponseDto {
  return { id: value.id, recipientId: value.recipientId, title: value.title, body: value.body,
    emailStatus: value.emailStatus, readAt: value.readAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString() };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService, private readonly mail: MailService) {}

  async create(input: CreateNotificationDto, actor: Actor, requestId?: string): Promise<NotificationResponseDto> {
    const recipient = await this.prisma.user.findFirst({ where: { id: input.recipientId, deletedAt: null },
      select: { id: true, email: true } });
    if (!recipient) throw new NotFoundException("Recipient not found");
    const created = await this.audit.transact(async (tx) => {
      const value = await tx.notification.create({ data: { recipientId: recipient.id, actorId: actor.id,
        title: input.title, body: input.body, emailStatus: input.sendEmail ? "PENDING" : "NOT_REQUESTED" } });
      return [value, { endpointId: "notification.create", policy: this.policy.for("notification.create"), actor,
        behavior: "created", module: "notifications", entityId: value.id,
        after: { id: value.id, recipientId: value.recipientId, title: value.title,
          emailRequested: Boolean(input.sendEmail) }, ...(requestId ? { requestId } : {}) }] as const;
    });
    if (!input.sendEmail) return publicNotification(created);
    let emailStatus: "SENT" | "FAILED" = "SENT";
    try { await this.mail.send({ to: recipient.email, subject: input.title, text: input.body }); }
    catch { emailStatus = "FAILED"; }
    const updated = await this.prisma.notification.update({ where: { id: created.id }, data: { emailStatus } });
    return publicNotification(updated);
  }

  async list(actor: Actor): Promise<NotificationResponseDto[]> {
    const values = await this.prisma.notification.findMany({ where: { recipientId: actor.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    return values.map(publicNotification);
  }

  async markRead(id: string, actor: Actor, requestId?: string): Promise<NotificationResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.notification.findFirst({ where: { id, recipientId: actor.id } });
      if (!prior) throw new NotFoundException("Notification not found");
      const next = prior.readAt ? prior : await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
      return [next, { endpointId: "notification.read", policy: this.policy.for("notification.read"), actor,
        behavior: "read", module: "notifications", entityId: id,
        before: { readAt: prior.readAt?.toISOString() ?? null },
        after: { readAt: next.readAt?.toISOString() ?? null }, ...(requestId ? { requestId } : {}) }] as const;
    });
    return publicNotification(value);
  }

  async unread(actor: Actor): Promise<NotificationResponseDto[]> {
    const values = await this.prisma.notification.findMany({ where: { recipientId: actor.id, readAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    return values.reverse().map(publicNotification);
  }
}
