import type { Notification } from "@prisma/client";
import { createTransport } from "nodemailer";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../core/errors/http-error.js";
import { auditService } from "../../core/audit/audit.service.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { NOTIFICATIONS_MODULE } from "../../constants/modules.constants.js";
import type { z } from "zod";
import { createNotification } from "../../core/http/endpoint-registry.js";
import { logger } from "../../core/logger/logger.js";

// Email is sent inside the request, so bound every SMTP phase well below client timeouts.
let transporter: ReturnType<typeof createTransport> | undefined;
function mailTransport(): ReturnType<typeof createTransport> {
  transporter ??= createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
    ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}) });
  return transporter;
}

export type CreateNotification = z.infer<typeof createNotification>;
export interface NotificationDto {
  id: string; recipientId: string; title: string; body: string;
  emailStatus: "NOT_REQUESTED" | "PENDING" | "SENT" | "FAILED";
  readAt: string | null; createdAt: string;
}
function toDto(value: Notification): NotificationDto {
  return { id: value.id, recipientId: value.recipientId, title: value.title, body: value.body,
    emailStatus: value.emailStatus, readAt: value.readAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString() };
}

export class NotificationService {
  async create(input: CreateNotification, actorId: string, requestId?: string): Promise<NotificationDto> {
    const recipient = await prisma.user.findFirst({ where: { id: input.recipientId, deletedAt: null },
      select: { id: true, email: true } });
    if (!recipient) throw HttpError.notFound("Recipient not found");
    const created = await prisma.$transaction(async (tx) => {
      const value = await tx.notification.create({ data: { recipientId: recipient.id, actorId,
        title: input.title, body: input.body, emailStatus: input.sendEmail ? "PENDING" : "NOT_REQUESTED" } });
      await auditService.persist({ action: AuditAction.CREATE, module: NOTIFICATIONS_MODULE,
        entityId: value.id, userId: actorId, after: { id: value.id, recipientId: value.recipientId,
          title: value.title, emailRequested: input.sendEmail }, requestId, trx: tx });
      return value;
    });
    if (!input.sendEmail) return toDto(created);
    let emailStatus: "SENT" | "FAILED" = "FAILED";
    if (env.SMTP_ENABLED) {
      try {
        await mailTransport().sendMail({ from: env.SMTP_FROM, to: recipient.email, subject: input.title, text: input.body });
        emailStatus = "SENT";
      } catch (err) {
        // A failed email must not roll back the saved notification; record why it failed.
        logger.warn({ err, notificationId: created.id, requestId }, "Notification email failed");
      }
    }
    return toDto(await prisma.notification.update({ where: { id: created.id }, data: { emailStatus } }));
  }

  async list(actorId: string): Promise<NotificationDto[]> {
    return (await prisma.notification.findMany({ where: { recipientId: actorId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 })).map(toDto);
  }

  async unread(actorId: string): Promise<NotificationDto[]> {
    const values = await prisma.notification.findMany({ where: { recipientId: actorId, readAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
    return values.reverse().map(toDto);
  }

  async markRead(id: string, actorId: string, requestId?: string): Promise<NotificationDto> {
    return toDto(await prisma.$transaction(async (tx) => {
      const prior = await tx.notification.findFirst({ where: { id, recipientId: actorId } });
      if (!prior) throw HttpError.notFound("Notification not found");
      const value = prior.readAt ? prior : await tx.notification.update({ where: { id }, data: { readAt: new Date() } });
      await auditService.persist({ action: AuditAction.UPDATE, module: NOTIFICATIONS_MODULE,
        entityId: id, userId: actorId, before: { readAt: prior.readAt?.toISOString() ?? null },
        after: { readAt: value.readAt?.toISOString() ?? null }, requestId, trx: tx });
      return value;
    }));
  }
}
