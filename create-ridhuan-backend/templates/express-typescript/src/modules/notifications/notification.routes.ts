import type { Express, Request, Response, NextFunction } from "express";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
import {
  requireAuthenticatedUser,
  requireRouteParam,
} from "../../core/http/request-context.js";
import { createNotification } from "../../core/http/endpoint-registry.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { NotificationService } from "./notification.service.js";
import { logger } from "../../core/logger/logger.js";
import { serveNotifications } from "../../core/http/notification-stream.js";
import { HttpError } from "../../core/errors/http-error.js";

const service = new NotificationService();
async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendCreated(
      res,
      await service.create(
        createNotification.parse(req.body),
        requireAuthenticatedUser(req).id,
        req.requestId,
      ),
    );
  } catch (error) {
    next(error);
  }
}
async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cursor = req.query["cursor"];
    if (cursor !== undefined && typeof cursor !== "string")
      throw HttpError.badRequest("Invalid notification cursor");
    const page = await service.listPage(
      requireAuthenticatedUser(req).id,
      cursor,
    );
    if (page.next) res.setHeader("X-Next-Cursor", page.next);
    sendSuccess(res, { data: page.items });
  } catch (error) {
    next(error);
  }
}
async function read(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, {
      data: await service.markRead(
        requireRouteParam(req, "id"),
        requireAuthenticatedUser(req).id,
        req.requestId,
      ),
    });
  } catch (error) {
    next(error);
  }
}
async function stream(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const actor = requireAuthenticatedUser(req);
  try {
    const cursor = await service.cursor(actor.id, req.get("Last-Event-ID"));
    await serveNotifications(
      res,
      cursor,
      (actor.exp ?? 0) * 1000,
      (after) => service.streamBatch(actor.id, after, cursor === undefined),
      () => logger.warn("Notification stream unavailable"),
    );
  } catch (error) {
    next(error);
  }
}
export function registerNotificationRoutes(app: Express): void {
  mountEndpoint(app, "notification.create", create);
  mountEndpoint(app, "notification.list", list);
  mountEndpoint(app, "notification.read", read);
  mountEndpoint(app, "notification.stream", stream);
}
