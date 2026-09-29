import { Logger } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { ApiRequest } from "./request-context";

const logger = new Logger("HttpAccess");

export function accessLog(request: ApiRequest, response: Response, next: NextFunction): void {
  const start = performance.now();
  response.once("finish", () => {
    logger.log(JSON.stringify({
      requestId: request.requestId,
      endpointId: request.endpointId,
      actorId: request.actor?.id,
      method: request.method,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - start),
    }));
  });
  next();
}
