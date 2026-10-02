import type { Response } from "express";
import type { PaginationMeta } from "../types/index.js";
import { currentEndpoint } from "../core/http/endpoint-context.js";
import { endpointPolicy } from "../core/http/endpoint-registry.js";

function ensureRequiredAudit(): void {
  const context = currentEndpoint();
  if (context && endpointPolicy(context.endpointId).audit === "required" && !context.auditWritten && !context.auditNoMutation) {
    throw new Error(`Required audit was not persisted for ${context.endpointId}`);
  }
}

interface SuccessOptions {
  data?: unknown;
  meta?: PaginationMeta;
  statusCode?: number;
}

export function sendSuccess(res: Response, options: SuccessOptions = {}): void {
  ensureRequiredAudit();
  const { data = null, meta, statusCode = 200 } = options;
  const body: Record<string, unknown> = { success: true, data };
  if (meta) {
    body["meta"] = meta;
  }
  const context = currentEndpoint();
  const responseSchema = context ? endpointPolicy(context.endpointId).response : undefined;
  if (responseSchema) {
    const wireBody: unknown = JSON.parse(JSON.stringify(body));
    if (!responseSchema.safeParse(wireBody).success) {
      throw new Error(`Response contract failed for ${context?.endpointId}`);
    }
    res.status(statusCode).json(wireBody);
    return;
  }
  res.status(statusCode).json(body);
}

export function sendCreated(res: Response, data: unknown): void {
  sendSuccess(res, { data, statusCode: 201 });
}

export function sendNoContent(res: Response): void {
  ensureRequiredAudit();
  res.status(204).end();
}
