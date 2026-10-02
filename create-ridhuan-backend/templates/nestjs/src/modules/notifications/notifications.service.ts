import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Notification } from "../../generated/prisma/client";
import { AuditService } from "../../common/audit/audit.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { PrismaService } from "../../platform/database/prisma.service";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/env.validation";
import type {
  CreateNotificationDto,
  NotificationResponseDto,
} from "./dto/notification.dto";

function publicNotification(value: Notification): NotificationResponseDto {
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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(
    input: CreateNotificationDto,
    actor: Actor,
    requestId?: string,
  ): Promise<NotificationResponseDto> {
    const recipient = await this.prisma.user.findFirst({
      where: { id: input.recipientId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!recipient) throw new NotFoundException("Recipient not found");
    const created = await this.audit.transact(async (tx) => {
      const allocation = await this.nextSequence(tx, recipient.id);
      const value = await tx.notification.create({
        data: {
          recipientId: recipient.id,
          actorId: actor.id,
          title: input.title,
          body: input.body,
          sequence: allocation.sequence,
          emailStatus: input.sendEmail
            ? this.config.get("SMTP_ENABLED", { infer: true })
              ? "PENDING"
              : "FAILED"
            : "NOT_REQUESTED",
        },
      });
      if (input.sendEmail && this.config.get("SMTP_ENABLED", { infer: true }))
        await tx.emailJob.create({
          data: {
            notificationId: value.id,
            recipient: allocation.email,
            title: input.title,
            body: input.body,
          },
        });
      return [
        value,
        {
          endpointId: "notification.create",
          policy: this.policy.for("notification.create"),
          actor,
          behavior: "created",
          module: "notifications",
          entityId: value.id,
          after: {
            id: value.id,
            recipientId: value.recipientId,
            title: value.title,
            emailRequested: Boolean(input.sendEmail),
          },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    return publicNotification(created);
  }
  private async nextSequence(
    tx: Prisma.TransactionClient,
    recipientId: string,
  ): Promise<{ sequence: bigint; email: string }> {
    const rows = await tx.$queryRawUnsafe<{ id: string; email: string }[]>(
      this.config.get("DB_PROVIDER", { infer: true }) === "mysql"
        ? "SELECT id,email FROM users WHERE id = ? AND deletedAt IS NULL FOR UPDATE"
        : 'SELECT id,email FROM users WHERE id = $1::uuid AND "deletedAt" IS NULL FOR UPDATE',
      recipientId,
    );
    if (!rows.length) throw new NotFoundException("Recipient not found");
    const counter = await tx.notificationCounter.upsert({
      where: { recipientId },
      create: { recipientId, sequence: 1n },
      update: { sequence: { increment: 1 } },
    });
    return { sequence: counter.sequence, email: rows[0]!.email };
  }
  async cursor(actor: Actor, id?: string): Promise<bigint | undefined> {
    if (id === undefined) return undefined;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new BadRequestException("Invalid notification cursor");
    const value = await this.prisma.notification.findFirst({
      where: { id, recipientId: actor.id },
      select: { sequence: true },
    });
    if (!value) throw new BadRequestException("Unknown notification cursor");
    return value.sequence;
  }
  async listPage(
    actor: Actor,
    cursor?: string,
  ): Promise<{ items: NotificationResponseDto[]; next?: string }> {
    const after = await this.cursor(actor, cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: actor.id,
        ...(after === undefined ? {} : { sequence: { lt: after } }),
      },
      orderBy: { sequence: "desc" },
      take: 51,
    });
    return {
      items: rows.slice(0, 50).map(publicNotification),
      ...(rows.length > 50 ? { next: rows[49]!.id } : {}),
    };
  }
  async list(actor: Actor): Promise<NotificationResponseDto[]> {
    return (await this.listPage(actor)).items;
  }
  async streamBatch(
    actor: Actor,
    after?: bigint,
    unreadOnly = false,
  ): Promise<
    { item: NotificationResponseDto; sequence: bigint }[] | undefined
  > {
    if (
      !(await this.prisma.user.findFirst({
        where: { id: actor.id, deletedAt: null },
        select: { id: true },
      }))
    )
      return undefined;
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: actor.id,
        ...(unreadOnly ? { readAt: null } : {}),
        ...(after === undefined ? {} : { sequence: { gt: after } }),
      },
      orderBy: { sequence: "asc" },
      take: 50,
    });
    return rows.map((value) => ({
      item: publicNotification(value),
      sequence: value.sequence,
    }));
  }

  async markRead(
    id: string,
    actor: Actor,
    requestId?: string,
  ): Promise<NotificationResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.notification.findFirst({
        where: { id, recipientId: actor.id },
      });
      if (!prior) throw new NotFoundException("Notification not found");
      const next = prior.readAt
        ? prior
        : await tx.notification.update({
            where: { id },
            data: { readAt: new Date() },
          });
      return [
        next,
        {
          endpointId: "notification.read",
          policy: this.policy.for("notification.read"),
          actor,
          behavior: "read",
          module: "notifications",
          entityId: id,
          before: { readAt: prior.readAt?.toISOString() ?? null },
          after: { readAt: next.readAt?.toISOString() ?? null },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    return publicNotification(value);
  }
}
