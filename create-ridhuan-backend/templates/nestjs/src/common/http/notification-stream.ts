import type { Response } from "express";
import { HttpException, HttpStatus } from "@nestjs/common";
import { sseConnection } from "../observability/telemetry";

// Each open stream polls the database; cap them so one account cannot exhaust the pool.
const MAX_STREAMS_PER_USER = 4;
const MAX_STREAMS_TOTAL = 128;
const streamsByUser = new Map<string, number>();
let streamsTotal = 0;

function acquireStreamSlot(userId: string): () => void {
  const current = streamsByUser.get(userId) ?? 0;
  if (streamsTotal >= MAX_STREAMS_TOTAL || current >= MAX_STREAMS_PER_USER) {
    throw new HttpException(
      "Too many open notification streams",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  streamsTotal += 1;
  streamsByUser.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    streamsTotal -= 1;
    const remaining = (streamsByUser.get(userId) ?? 1) - 1;
    if (remaining <= 0) streamsByUser.delete(userId);
    else streamsByUser.set(userId, remaining);
  };
}

export interface NotificationEvent {
  id: string;
}
export interface StreamRow<T extends NotificationEvent> {
  item: T;
  sequence: bigint;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function write(
  response: Response,
  value: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || response.destroyed) return;
  if (response.write(value)) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      response.off("drain", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    response.once("drain", finish);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Cursor validation belongs to the caller, before opening this stream. */
export async function serveNotifications<T extends NotificationEvent>(
  response: Response,
  userId: string,
  cursor: bigint | undefined,
  expiresAt: number,
  batch: (after: bigint | undefined) => Promise<StreamRow<T>[] | undefined>,
  report: () => void,
): Promise<void> {
  const release = acquireStreamSlot(userId);
  const lifetime = Math.min(14 * 60_000, Math.max(0, expiresAt - Date.now()));
  const stop = new AbortController();
  const close = (): void => {
    stop.abort();
  };
  response.once("close", close);
  const expiry = setTimeout(() => {
    close();
    if (!response.destroyed) response.end();
  }, lifetime);
  const heartbeat = setInterval(() => {
    if (
      !stop.signal.aborted &&
      !response.destroyed &&
      !response.writableNeedDrain
    )
      response.write(": heartbeat\n\n");
  }, 15_000);
  response.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  sseConnection(1);
  try {
    while (!stop.signal.aborted) {
      const rows = await batch(cursor);
      if (rows === undefined) break;
      for (const row of rows) {
        if (stop.signal.aborted) break;
        await write(
          response,
          `id: ${row.item.id}\nevent: notification\ndata: ${JSON.stringify(row.item)}\n\n`,
          stop.signal,
        );
        cursor = row.sequence;
      }
      // A full batch may have more backlog. Drain it before waiting for new inserts.
      if (rows.length < 50) await pause(3000, stop.signal);
    }
  } catch {
    report();
  } finally {
    release();
    sseConnection(-1);
    clearTimeout(expiry);
    clearInterval(heartbeat);
    response.off("close", close);
    stop.abort();
    if (!response.destroyed) response.end();
  }
}
