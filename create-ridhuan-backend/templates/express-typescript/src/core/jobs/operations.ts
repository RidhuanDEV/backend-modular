import {
  observed,
  emailAttempt,
  outboxState,
  cleanupItems,
} from "../observability/telemetry.js";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { PrismaClient, EmailJob } from "@prisma/client";

export interface OperationsConfig {
  concurrency: number;
  pollSeconds: number;
  leaseSeconds: number;
  renewSeconds: number;
  maxAttempts: number;
  batchSize: number;
  sessionDays: number;
  outboxDays: number;
  auditEnabled: boolean;
  auditDays: number;
}
export function operationsConfig(
  source: NodeJS.ProcessEnv = process.env,
): OperationsConfig {
  const integer = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const raw = source[key] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${key}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${key}`);
    return value;
  };
  const flag = source["CLEANUP_AUDIT_ENABLED"] ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new Error("Invalid CLEANUP_AUDIT_ENABLED");
  if (flag === "true" && !source["CLEANUP_AUDIT_DAYS"])
    throw new Error(
      "CLEANUP_AUDIT_DAYS must be explicit when audit deletion is enabled",
    );
  const result = {
    concurrency: integer("WORKER_CONCURRENCY", 2, 1, 16),
    pollSeconds: integer("WORKER_POLL_SECONDS", 3, 1, 300),
    leaseSeconds: integer("WORKER_LEASE_SECONDS", 60, 30, 3600),
    renewSeconds: integer("WORKER_RENEW_SECONDS", 20, 1, 1800),
    maxAttempts: integer("WORKER_MAX_ATTEMPTS", 5, 1, 5),
    batchSize: integer("CLEANUP_BATCH_SIZE", 500, 1, 5000),
    sessionDays: integer("CLEANUP_SESSION_DAYS", 30, 1, 3650),
    outboxDays: integer("CLEANUP_OUTBOX_DAYS", 30, 1, 3650),
    auditEnabled: flag === "true",
    auditDays: integer("CLEANUP_AUDIT_DAYS", 365, 1, 36500),
  };
  if (result.renewSeconds * 2 >= result.leaseSeconds)
    throw new Error("Lease renewal must be less than half the lease duration");
  return result;
}
export interface EmailPayload {
  recipient: string;
  title: string;
  body: string;
}
type Database = Pick<
  PrismaClient,
  "$transaction" | "emailJob" | "notification" | "refreshFamily" | "activityLog"
>;
type Report = (message: string, jobId?: string) => void;
const retries = [5, 30, 120, 600] as const;
/** Remain idle without DB work while SMTP is off, including Compose --wait. */
export async function waitForWorkerShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 60_000);
    const finish = (): void => {
      clearInterval(keepAlive);
      process.removeListener("SIGTERM", finish);
      process.removeListener("SIGINT", finish);
      resolve();
    };
    process.once("SIGTERM", finish);
    process.once("SIGINT", finish);
  });
}
export async function runEmailWorker(
  db: Database,
  provider: "postgresql" | "mysql",
  enabled: boolean,
  send: (payload: EmailPayload) => Promise<void>,
  report: Report,
): Promise<void> {
  if (!enabled) {
    report("SMTP disabled; worker is idle until shutdown");
    await waitForWorkerShutdown();
    return;
  }
  const config = operationsConfig();
  const stop = new AbortController();
  const halt = (): void => {
    stop.abort();
  };
  process.once("SIGTERM", halt);
  process.once("SIGINT", halt);
  const table = provider === "mysql" ? "`EmailJob`" : '"EmailJob"';
  const due = provider === "mysql" ? "\x60availableAt\x60" : '"availableAt"';
  const leaseColumn =
    provider === "mysql" ? "\x60leaseUntil\x60" : '"leaseUntil"';
  const parameter = provider === "mysql" ? "?" : "$1";
  async function claim(): Promise<EmailJob | undefined> {
    return db.$transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.$queryRawUnsafe<EmailJob[]>(
        `SELECT * FROM ${table} WHERE (status = 'PENDING' AND ${due} <= ${parameter}) OR (status = 'PROCESSING' AND ${leaseColumn} <= ${provider === "mysql" ? "?" : "$2"}) ORDER BY ${due}, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        now,
        now,
      );
      const job = rows[0];
      if (!job) return undefined;
      if (job.attempts >= config.maxAttempts) {
        await tx.emailJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completedAt: now,
            leaseId: null,
            leaseUntil: null,
          },
        });
        await tx.notification.update({
          where: { id: job.notificationId },
          data: { emailStatus: "FAILED" },
        });
        return undefined;
      }
      return tx.emailJob.update({
        where: { id: job.id },
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          leaseId: randomUUID(),
          leaseUntil: new Date(now.getTime() + config.leaseSeconds * 1000),
        },
      });
    });
  }
  async function deliver(job: EmailJob): Promise<void> {
    const done = new AbortController();
    let lost = false;
    const renewal = (async (): Promise<void> => {
      while (!done.signal.aborted) {
        try {
          await pause(config.renewSeconds * 1000, undefined, {
            signal: done.signal,
          });
        } catch {
          return;
        }
        try {
          const changed = await db.emailJob.updateMany({
            where: {
              id: job.id,
              status: "PROCESSING",
              leaseId: job.leaseId,
              leaseUntil: { gt: new Date() },
            },
            data: {
              leaseUntil: new Date(Date.now() + config.leaseSeconds * 1000),
            },
          });
          if (changed.count !== 1) {
            lost = true;
            return;
          }
        } catch {
          lost = true;
          report("Email lease renewal failed", job.id);
          return;
        }
      }
    })();
    let success = false;
    try {
      await observed("email", () =>
        send({ recipient: job.recipient, title: job.title, body: job.body }),
      );
      success = true;
    } catch {
      report("Email attempt failed", job.id);
    } finally {
      done.abort();
      await renewal;
    }
    if (lost) return;
    const outcome = await db.$transaction(async (tx) => {
      const terminal = success || job.attempts >= config.maxAttempts;
      const status = terminal ? (success ? "SENT" : "FAILED") : "PENDING";
      const retry =
        retries[Math.min(job.attempts - 1, retries.length - 1)] ?? 600;
      const changed = await tx.emailJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          leaseId: job.leaseId,
          leaseUntil: { gt: new Date() },
        },
        data: {
          status,
          leaseId: null,
          leaseUntil: null,
          ...(terminal
            ? { completedAt: new Date() }
            : { availableAt: new Date(Date.now() + retry * 1000) }),
        },
      });
      if (changed.count === 1 && terminal)
        await tx.notification.update({
          where: { id: job.notificationId },
          data: { emailStatus: success ? "SENT" : "FAILED" },
        });
      return changed.count === 1
        ? terminal
          ? success
            ? "SENT"
            : "FAILED"
          : "RETRY"
        : undefined;
    });
    if (outcome) emailAttempt(outcome);
  }
  async function consume(): Promise<void> {
    while (!stop.signal.aborted) {
      try {
        const pending = await db.emailJob.count({
          where: { status: { in: ["PENDING", "PROCESSING"] } },
        });
        const oldest = await db.emailJob.aggregate({
          where: { status: { in: ["PENDING", "PROCESSING"] } },
          _min: { createdAt: true },
        });
        outboxState(pending, oldest._min.createdAt ?? undefined);
        const job = await claim();
        if (job) {
          await deliver(job);
          continue;
        }
      } catch {
        report("Worker persistence unavailable");
      }
      try {
        await pause(config.pollSeconds * 1000, undefined, {
          signal: stop.signal,
        });
      } catch {
        return;
      }
    }
  }
  try {
    await Promise.all(
      Array.from({ length: config.concurrency }, () => consume()),
    );
  } finally {
    process.removeListener("SIGTERM", halt);
    process.removeListener("SIGINT", halt);
  }
}
export async function cleanupRows(
  db: Database,
  apply: boolean,
  report: Report,
): Promise<void> {
  const config = operationsConfig(),
    now = Date.now(),
    sessionCutoff = new Date(now - config.sessionDays * 86400000);
  // Recheck the eligibility in each DELETE so concurrent refresh/completion wins safely.
  const counts = await db.$transaction(async (tx) => {
    const families = await tx.refreshFamily.findMany({
      where: {
        OR: [
          { revokedAt: { lt: sessionCutoff } },
          { revokedAt: null, expiresAt: { lt: sessionCutoff } },
        ],
      },
      orderBy: { id: "asc" },
      take: config.batchSize,
      select: { id: true },
    });
    const jobs = await tx.emailJob.findMany({
      where: {
        status: { in: ["SENT", "FAILED"] },
        completedAt: { lt: new Date(now - config.outboxDays * 86400000) },
      },
      orderBy: { id: "asc" },
      take: config.batchSize,
      select: { id: true },
    });
    const logs = config.auditEnabled
      ? await tx.activityLog.findMany({
          where: {
            createdAt: { lt: new Date(now - config.auditDays * 86400000) },
          },
          orderBy: { id: "asc" },
          take: config.batchSize,
          select: { id: true },
        })
      : [];
    const counts = {
      sessions: families.length,
      outbox: jobs.length,
      audit: logs.length,
    };
    if (apply) {
      counts.sessions = (
        await tx.refreshFamily.deleteMany({
          where: {
            id: { in: families.map((f) => f.id) },
            OR: [
              { revokedAt: { lt: sessionCutoff } },
              { revokedAt: null, expiresAt: { lt: sessionCutoff } },
            ],
          },
        })
      ).count;
      counts.outbox = (
        await tx.emailJob.deleteMany({
          where: {
            id: { in: jobs.map((j) => j.id) },
            status: { in: ["SENT", "FAILED"] },
            completedAt: { lt: new Date(now - config.outboxDays * 86400000) },
          },
        })
      ).count;
      if (config.auditEnabled)
        counts.audit = (
          await tx.activityLog.deleteMany({
            where: {
              id: { in: logs.map((l) => l.id) },
              createdAt: { lt: new Date(now - config.auditDays * 86400000) },
            },
          })
        ).count;
    }
    return counts;
  });
  cleanupItems("sessions", counts.sessions, apply);
  cleanupItems("outbox", counts.outbox, apply);
  cleanupItems("audit", counts.audit, apply);
  report(
    `${apply ? "delete" : "candidate"} families=${counts.sessions} outbox=${counts.outbox} audit=${counts.audit}`,
  );
}
