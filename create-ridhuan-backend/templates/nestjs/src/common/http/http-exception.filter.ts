import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { Failure } from "./response";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException ? exception.getResponse() : null;
    let message = "Internal server error";
    let errors: string[] = [];
    if (typeof detail === "string") message = detail;
    else if (detail && typeof detail === "object" && "message" in detail) {
      const value = detail.message;
      if (typeof value === "string") message = value;
      else if (Array.isArray(value)) {
        errors = value.filter((item): item is string => typeof item === "string");
        message = "Validation failed";
      }
    }
    if (status >= 500 && !(exception instanceof HttpException)) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const body: Failure = { success: false, message, errors };
    response.status(status).json(body);
  }
}
