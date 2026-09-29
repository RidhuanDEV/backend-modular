import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../platform/database/prisma.service";
import type { Actor } from "../http/request-context";
import type { EndpointDefinition, EndpointId } from "../endpoint/endpoint.registry";

type Writer = Pick<Prisma.TransactionClient, "activityLog">;
export interface AuditChange {
  endpointId: EndpointId;
  policy: EndpointDefinition;
  actor?: Actor;
  behavior: string;
  module: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  requestId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async transact<T>(operation: (tx: Prisma.TransactionClient) => Promise<readonly [T, AuditChange]>): Promise<T> {
    const [value, change] = await this.prisma.$transaction(async (tx) => {
      const result = await operation(tx);
      if (result[1].policy.audit === "required") await this.write(result[1], tx);
      return result;
    });
    if (change.policy.audit === "optional") await this.write(change);
    return value;
  }

  async write(change: AuditChange, writer: Writer = this.prisma): Promise<void> {
    if (change.policy.audit === "none") return;
    const action = writer.activityLog.create({ data: {
      behavior: change.behavior, module: change.module,
      ...(change.entityId ? { entityId: change.entityId } : {}),
      ...(change.actor ? { userId: change.actor.id, actorIdSnapshot: change.actor.id } : {}),
      ...(change.before ? { before: change.before } : {}),
      ...(change.after ? { after: change.after } : {}),
      ...(change.requestId ? { requestId: change.requestId } : {}),
      endpointId: change.endpointId,
    } });
    if (change.policy.audit === "required") { await action; return; }
    try { await action; } catch (error) {
      this.logger.warn(`Optional audit failed for ${change.endpointId}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
}
