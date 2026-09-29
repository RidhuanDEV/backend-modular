import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface Actor { id: string; email: string; roleId: string; }
export interface ApiRequest extends Request { requestId?: string; actor?: Actor; endpointId?: string; accessExpiresAt?: number; }

export function requestContext(request: ApiRequest, response: Response, next: NextFunction): void {
  const supplied = request.header("x-request-id");
  const id = supplied && /^[A-Za-z0-9_-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  request.requestId = id;
  response.setHeader("x-request-id", id);
  next();
}
