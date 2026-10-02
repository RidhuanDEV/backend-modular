import type { Prisma, Notification } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../core/errors/http-error.js";
import { auditService } from "../../core/audit/audit.service.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { NOTIFICATIONS_MODULE } from "../../constants/modules.constants.js";
import type { z } from "zod";
import { createNotification } from "../../core/http/endpoint-registry.js";

export type CreateNotification = z.infer<typeof createNotification>;
export interface NotificationDto {
  id: string;
  recipientId: string;
  title: string;
  body: string;
  emailStatus: "NOT_REQUESTED" | "PENDING" | "SENT" | "FAILED";
  readAt: string | null;
  createdAt: string;
}
function toDto(value: Notification): NotificationDto {
  return {
    id: value.id,
    recipientId: value.recipientId,
    title: value.title,
    body: value.body,
    emailStatus: value.emailStatus,
    readAt: value.readAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
  };
}

export class NotificationService {
  async create(
    input: CreateNotification,
    actorId: string,
    requestId?: string,
  ): Promise<NotificationDto> {
    const recipient = await prisma.user.findFirst({
      where: { id: input.recipientId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!recipient) throw HttpError.notFound("Recipient not found");
    const created = await auditService.transaction(async (tx) => {
      const allocation = await this.nextSequence(tx, recipient.id);
      const value = await tx.notification.create({
        data: {
          recipientId: recipient.id,
          actorId,
          title: input.title,
          body: input.body,
          sequence: allocation.sequence,
          emailStatus: input.sendEmail
            ? env.SMTP_ENABLED
              ? "PENDING"
              : "FAILED"
            : "NOT_REQUESTED",
        },
      });
      if (input.sendEmail && env.SMTP_ENABLED)
        await tx.emailJob.create({
          data: {
            notificationId: value.id,
            recipient: allocation.email,
            title: input.title,
            body: input.body,
          },
        });
      await auditService.persist({
        action: AuditAction.CREATE,
        module: NOTIFICATIONS_MODULE,
        entityId: value.id,
        userId: actorId,
        after: {
          id: value.id,
          recipientId: value.recipientId,
          title: value.title,
          emailRequested: input.sendEmail,
        },
        requestId,
        trx: tx,
      });
      return value;
    });
    return toDto(created);
  }

  private async nextSequence(
    tx: Prisma.TransactionClient,
    recipientId: string,
  ): Promise<{ sequence: bigint; email: string }> {
    const rows = await tx.$queryRawUnsafe<{ id: string; email: string }[]>(
      env.DB_PROVIDER === "mysql"
        ? "SELECT id,email FROM `User` WHERE id = ? AND deletedAt IS NULL FOR UPDATE"
        : 'SELECT id,email FROM "User" WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE',
      recipientId,
    );
    if (!rows.length) throw HttpError.notFound("Recipient not found");
    const counter = await tx.notificationCounter.upsert({
      where: { recipientId },
      create: { recipientId, sequence: 1n },
      update: { sequence: { increment: 1 } },
    });
    return { sequence: counter.sequence, email: rows[0]!.email };
  }
  async cursor(actorId: string, id?: string): Promise<bigint | undefined> {
    if (id === undefined) return undefined;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw HttpError.badRequest("Invalid notification cursor");
    const value = await prisma.notification.findFirst({
      where: { id, recipientId: actorId },
      select: { sequence: true },
    });
    if (!value) throw HttpError.badRequest("Unknown notification cursor");
    return value.sequence;
  }
  async listPage(
    actorId: string,
    cursor?: string,
  ): Promise<{ items: NotificationDto[]; next?: string }> {
    const after = await this.cursor(actorId, cursor);
    const rows = await prisma.notification.findMany({
      where: {
        recipientId: actorId,
        ...(after === undefined ? {} : { sequence: { lt: after } }),
      },
      orderBy: { sequence: "desc" },
      take: 51,
    });
    return {
      items: rows.slice(0, 50).map(toDto),
      ...(rows.length > 50 ? { next: rows[49]!.id } : {}),
    };
  }
  async list(actorId: string): Promise<NotificationDto[]> {
    return (await this.listPage(actorId)).items;
  }
  async streamBatch(
    actorId: string,
    after?: bigint,
    unreadOnly = false,
  ): Promise<{ item: NotificationDto; sequence: bigint }[] | undefined> {
    if (
      !(await prisma.user.findFirst({
        where: { id: actorId, deletedAt: null },
        select: { id: true },
      }))
    )
      return undefined;
    const rows = await prisma.notification.findMany({
      where: {
        recipientId: actorId,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(after === undefined ? {} : { sequence: { gt: after } }),
      },
      orderBy: { sequence: "asc" },
      take: 50,
    });
    return rows.map((value) => ({
      item: toDto(value),
      sequence: value.sequence,
    }));
  }

  async markRead(
    id: string,
    actorId: string,
    requestId?: string,
  ): Promise<NotificationDto> {
    return toDto(
      await auditService.transaction(async (tx) => {
        const prior = await tx.notification.findFirst({
          where: { id, recipientId: actorId },
        });
        if (!prior) throw HttpError.notFound("Notification not found");
        const value = prior.readAt
          ? prior
          : await tx.notification.update({
              where: { id },
              data: { readAt: new Date() },
            });
        await auditService.persist({
          action: AuditAction.UPDATE,
          module: NOTIFICATIONS_MODULE,
          entityId: id,
          userId: actorId,
          before: { readAt: prior.readAt?.toISOString() ?? null },
          after: { readAt: value.readAt?.toISOString() ?? null },
          requestId,
          trx: tx,
        });
        return value;
      }),
    );
  }
}
