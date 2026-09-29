import type { Express, Request, Response, NextFunction } from "express";
import { mountEndpoint, } from "../../core/http/mount-endpoint.js";
import { requireAuthenticatedUser, requireRouteParam } from "../../core/http/request-context.js";
import { createNotification } from "../../core/http/endpoint-registry.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { NotificationService } from "./notification.service.js";
import { logger } from "../../core/logger/logger.js";

const service = new NotificationService();
async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendCreated(res, await service.create(createNotification.parse(req.body),
    requireAuthenticatedUser(req).id, req.requestId)); } catch (error) { next(error); }
}
async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, { data: await service.list(requireAuthenticatedUser(req).id) }); }
  catch (error) { next(error); }
}
async function read(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, { data: await service.markRead(requireRouteParam(req, "id"),
    requireAuthenticatedUser(req).id, req.requestId) }); } catch (error) { next(error); }
}
async function stream(req: Request, res: Response): Promise<void> {
  const actor = requireAuthenticatedUser(req);
  const actorId = actor.id;
  const sent = new Set<string>();
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no" });
  res.flushHeaders();
  let inFlight = false;
  const poll = async (): Promise<void> => {
    if (inFlight || res.destroyed) return;
    inFlight = true;
    try {
      for (const item of await service.unread(actorId)) {
        if (sent.has(item.id)) continue;
        sent.add(item.id);
        res.write(`id: ${item.id}\nevent: notification\ndata: ${JSON.stringify(item)}\n\n`);
      }
    } catch (error) {
      res.write(`event: error\ndata: {"message":"Notification stream unavailable"}\n\n`);
      logger.warn({ error }, "Notification stream poll failed");
      cleanup(); res.end();
    } finally { inFlight = false; }
  };
  const interval = setInterval(() => { void poll(); }, 3000);
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 15000);
  const remaining = Math.max(0, (actor.exp ?? 0) * 1000 - Date.now());
  const expiry = setTimeout(() => { cleanup(); res.end(); }, Math.min(14 * 60 * 1000, remaining));
  const cleanup = (): void => { clearInterval(interval); clearInterval(heartbeat); clearTimeout(expiry); };
  res.on("close", cleanup);
  await poll();
}
export function registerNotificationRoutes(app: Express): void {
  mountEndpoint(app, "notification.create", create);
  mountEndpoint(app, "notification.list", list);
  mountEndpoint(app, "notification.read", read);
  mountEndpoint(app, "notification.stream", stream);
}
