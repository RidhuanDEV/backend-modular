import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/http-error.js";
import { logger } from "../logger/logger.js";
import multer from "multer";
import { Prisma } from "@prisma/client";

// Expected Prisma failures that describe the request, not a server bug.
const prismaClientErrors: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: "Resource already exists" },
  P2003: { status: 409, message: "Resource is referenced or missing" },
  P2025: { status: 404, message: "Resource not found" },
};

function isBodyParserError(err: unknown): err is Error & { status: number; type: string } {
  return (
    typeof err === "object" && err !== null &&
    typeof (err as { type?: unknown }).type === "string" &&
    typeof (err as { status?: unknown }).status === "number" &&
    (err as { status: number }).status >= 400 && (err as { status: number }).status < 500
  );
}

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId;

  if (err instanceof multer.MulterError) {
    const statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(statusCode).json({ success: false, message: err.message, errors: [] });
    return;
  }

  if (err instanceof HttpError) {
    logger.warn({
      requestId,
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && prismaClientErrors[err.code]) {
    const mapped = prismaClientErrors[err.code]!;
    logger.warn({ requestId, code: err.code, path: req.path, method: req.method }, mapped.message);
    res.status(mapped.status).json({ success: false, message: mapped.message, errors: [] });
    return;
  }

  if (isBodyParserError(err)) {
    const message = err.status === 413 ? "Request body too large" : "Malformed request body";
    res.status(err.status).json({ success: false, message, errors: [] });
    return;
  }

  logger.error({
    requestId,
    err,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    errors: [],
  });
}
