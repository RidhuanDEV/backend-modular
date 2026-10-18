import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../platform/database/prisma.service";
import type { Actor } from "../http/request-context";
import type {
  EndpointDefinition,
  EndpointId,
} from "../endpoint/endpoint.registry";

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

const SECRET_KEY =
  /password|token|authorization|secret|api.?key|credential|cookie/i;

/**
 * Defense in depth: snapshots are built explicitly by callers, but a secret
 * field added to one later must still never reach the audit table.
 */
export function scrubAuditValue(
  value: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  if (Array.isArray(value))
    return value.map((item: Prisma.InputJsonValue) => scrubAuditValue(item));
  if (value !== null && typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      output[key] = SECRET_KEY.test(key)
        ? "[REDACTED]"
        : nested === null
          ? null
          : scrubAuditValue(nested as Prisma.InputJsonValue);
    }
    return output;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async transact<T>(
    operation: (
      tx: Prisma.TransactionClient,
    ) => Promise<readonly [T, AuditChange]>,
  ): Promise<T> {
    const [value, change] = await this.prisma.$transaction(async (tx) => {
      const result = await operation(tx);
      if (result[1].policy.audit === "required")
        await this.write(result[1], tx);
      return result;
    });
    if (change.policy.audit === "optional") await this.write(change);
    return value;
  }

  async write(
    change: AuditChange,
    writer: Writer = this.prisma,
  ): Promise<void> {
    if (change.policy.audit === "none") return;
    const action = writer.activityLog.create({
      data: {
        behavior: change.behavior,
        module: change.module,
        ...(change.entityId ? { entityId: change.entityId } : {}),
        ...(change.actor
          ? { userId: change.actor.id, actorIdSnapshot: change.actor.id }
          : {}),
        ...(change.before ? { before: scrubAuditValue(change.before) } : {}),
        ...(change.after ? { after: scrubAuditValue(change.after) } : {}),
        ...(change.requestId ? { requestId: change.requestId } : {}),
        endpointId: change.endpointId,
      },
    });
    if (change.policy.audit === "required") {
      await action;
      return;
    }
    try {
      await action;
    } catch (error) {
      this.logger.warn(
        `Optional audit failed for ${change.endpointId}: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  }
}
