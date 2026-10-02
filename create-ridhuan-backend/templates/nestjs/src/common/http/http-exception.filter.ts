import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "../../generated/prisma/client";
import type { Failure } from "./response";

// Expected Prisma failures that describe the request, not a server bug.
const prismaClientErrors: Record<string, { status: number; message: string }> =
  {
    P2002: { status: HttpStatus.CONFLICT, message: "Resource already exists" },
    P2003: {
      status: HttpStatus.CONFLICT,
      message: "Resource is referenced or missing",
    },
    P2025: { status: HttpStatus.NOT_FOUND, message: "Resource not found" },
  };

function isBodyParserError(
  exception: unknown,
): exception is Error & { status: number; type: string } {
  if (typeof exception !== "object" || exception === null) return false;
  const { status, type } = exception as { status?: unknown; type?: unknown };
  return (
    typeof type === "string" &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      prismaClientErrors[exception.code]
    ) {
      const mapped = prismaClientErrors[exception.code]!;
      response
        .status(mapped.status)
        .json({
          success: false,
          message: mapped.message,
          errors: [],
        } satisfies Failure);
      return;
    }
    if (isBodyParserError(exception)) {
      const message =
        exception.status === 413
          ? "Request body too large"
          : "Malformed request body";
      response
        .status(exception.status)
        .json({ success: false, message, errors: [] } satisfies Failure);
      return;
    }
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail =
      exception instanceof HttpException ? exception.getResponse() : null;
    let message = "Internal server error";
    let errors: string[] = [];
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object" && "message" in detail) {
      const value = detail.message;
      if (typeof value === "string") message = value;
      else if (Array.isArray(value)) {
        errors = value.filter(
          (item): item is string => typeof item === "string",
        );
        message = "Validation failed";
      }
    }
    if (status >= 500 && !(exception instanceof HttpException))
      this.logger.error({
        message: "Request failed",
        errorType: exception instanceof Error ? exception.name : "unknown",
      });
    const body: Failure = { success: false, message, errors };
    response.status(status).json(body);
  }
}
