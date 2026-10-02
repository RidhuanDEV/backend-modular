import type { Prisma } from "@prisma/client";
import { logger } from "../logger/logger.js";
import { auditLogRepository } from "./audit-log.repository.js";
import type { AuditActionType } from "../../constants/audit.constants.js";
import type { ModuleName } from "../../constants/modules.constants.js";
import { currentEndpoint } from "../http/endpoint-context.js";
import { endpointPolicy } from "../http/endpoint-registry.js";
import { prisma } from "../../config/prisma.js";

type TransactionClient = Prisma.TransactionClient;

export interface PersistAuditOptions {
  /** Use a value from AuditAction, e.g. AuditAction.CREATE. */
  action: AuditActionType;
  /** Use a value from module constants, e.g. USER_MODULE. */
  module: ModuleName;
  /** Primary key of the affected record */
  entityId?: string | null;
  /** ID of the user who triggered the action */
  userId?: string | null;
  /** Snapshot of the record before the change (omit for CREATE) */
  before?: unknown;
  /** Payload after the change (omit for DELETE) */
  after?: unknown;
  /** X-Request-Id for cross-referencing with access logs */
  requestId?: string | undefined;
  /**
   * Prisma transaction client to join.
   * Pass the same transaction as the main mutation so that the audit
   * record is rolled back if the data write fails.
   */
  trx?: TransactionClient;
}

export class AuditService {
  /** Explicit idempotent logout outcome: no mutation means no audit record. */
  noLogoutMutation(): void {
    const context = currentEndpoint();
    if (context?.endpointId === "auth.logout") context.auditNoMutation = true;
  }

  /** Discard optional audit intents if the owning mutation fails to commit. */
  async transaction<T>(
    operation: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    const context = currentEndpoint();
    const checkpoint = context?.pendingAudits.length ?? 0;
    try {
      return await prisma.$transaction(operation);
    } catch (error) {
      context?.pendingAudits.splice(checkpoint);
      throw error;
    }
  }

  /**
   * Persistent audit trail — writes to the `crud_audit_logs` table.
   *
   * For required mutations, pass the same transaction as the business write.
   * Optional writes are queued until the request handler completes.
   */
  async persist(options: PersistAuditOptions): Promise<void> {
    const { action, module, entityId, userId, before, after, requestId, trx } =
      options;
    const context = currentEndpoint();
    const mode = context
      ? endpointPolicy(context.endpointId).audit
      : "required";
    if (mode === "none") return;
    if (mode === "required" && context && action !== "LOGIN" && !trx) {
      throw new Error(
        `Required audit for ${context.endpointId} needs the business transaction`,
      );
    }
    const data = {
      action,
      module,
      entityId: entityId ?? null,
      userId: userId ?? null,
      before,
      after,
      requestId: requestId ?? null,
      endpointId: context?.endpointId ?? null,
    };
    if (mode === "optional" && context) {
      context.pendingAudits.push(() => auditLogRepository.create(data));
      context.auditWritten = true;
      return;
    }
    await auditLogRepository.create(data, trx);
    if (context) context.auditWritten = true;

    // Mirror to logger for real-time observability alongside the DB write.
    logger.info(
      { action, module, userId, entityId, endpointId: context?.endpointId },
      "Audit persisted",
    );
  }
}

export const auditService = new AuditService();
