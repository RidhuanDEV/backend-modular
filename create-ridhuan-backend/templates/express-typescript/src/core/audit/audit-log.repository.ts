import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export interface CreateAuditLogData {
  action: string;
  module: string;
  entityId?: string | null;
  userId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  endpointId?: string | null;
}

const secretKey =
  /password|token|authorization|secret|api.?key|credential|cookie/i;

function scrub(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (depth > 6) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 4096);
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return null;
  if (Array.isArray(value))
    return value.slice(0, 100).map((entry: unknown) => scrub(entry, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 100)) {
      result[key] = secretKey.test(key)
        ? "[REDACTED]"
        : scrub(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}

export class AuditLogRepository {
  async create(
    data: CreateAuditLogData,
    trx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = trx ?? prisma;
    await client.activityLog.create({
      data: {
        behavior: data.action,
        module: data.module,
        entityId: data.entityId ?? null,
        userId: data.userId ?? null,
        actorIdSnapshot: data.userId ?? null,
        before:
          data.before === undefined
            ? Prisma.JsonNull
            : (scrub(data.before) ?? Prisma.JsonNull),
        after:
          data.after === undefined
            ? Prisma.JsonNull
            : (scrub(data.after) ?? Prisma.JsonNull),
        requestId: data.requestId ?? null,
        endpointId: data.endpointId ?? null,
      },
    });
  }
}

export const auditLogRepository = new AuditLogRepository();
