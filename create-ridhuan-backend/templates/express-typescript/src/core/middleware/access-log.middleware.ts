import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger/logger.js";
import { currentEndpoint } from "../http/endpoint-context.js";

export function accessLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startTime = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(startTime);
    const timeMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);

    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        endpointId: currentEndpoint()?.endpointId ?? "unregistered",
        status: res.statusCode,
        responseTimeMs: parseFloat(timeMs),
      },
      "HTTP response",
    );
  });

  next();
}
