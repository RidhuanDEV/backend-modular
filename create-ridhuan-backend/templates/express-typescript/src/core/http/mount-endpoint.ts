import type { Express, RequestHandler } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { requirePermission } from "../auth/rbac.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { rateLimiter } from "../middleware/rate-limit.middleware.js";
import {
  endpointPolicy,
  endpointRegistry,
  type EndpointId,
} from "./endpoint-registry.js";
import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";
import { currentEndpoint, runWithEndpoint } from "./endpoint-context.js";
import { auditLogRepository } from "../audit/audit-log.repository.js";

const mounted = new Set<EndpointId>();

export function mountEndpoint(
  app: Express,
  id: EndpointId,
  handler: RequestHandler,
  extra: RequestHandler[] = [],
): void {
  if (mounted.has(id)) throw new Error(`Endpoint mounted twice: ${id}`);
  const policy = endpointPolicy(id);
  if (!env.UPLOAD_ENABLED && policy.module === "upload") return;
  const before: RequestHandler[] = [
    (_req, _res, next) => {
      runWithEndpoint(id, next);
    },
  ];
  if (policy.access.kind === "public") {
    before.push(rateLimiter(policy.rateLimit));
  } else {
    before.push(rateLimiter("public"), authenticate);
    if (policy.access.permission)
      before.push(requirePermission(policy.access.permission));
    before.push(rateLimiter(policy.rateLimit));
  }
  before.push(
    validate({
      ...(policy.body ? { body: policy.body } : {}),
      ...(policy.query ? { query: policy.query } : {}),
      ...(policy.params ? { params: policy.params } : {}),
    }),
  );
  const wrapped: RequestHandler = async (req, res, next) => {
    let failed = false;
    await handler(req, res, (err?: unknown) => {
      if (err) failed = true;
      next(err);
    });
    const context = currentEndpoint();
    if (
      context &&
      !failed &&
      policy.audit === "optional" &&
      !context.auditWritten &&
      policy.method === "GET" &&
      res.statusCode < 400
    ) {
      context.pendingAudits.push(() =>
        auditLogRepository.create({
          action: "READ",
          module: policy.module,
          entityId:
            typeof req.params["id"] === "string" ? req.params["id"] : null,
          userId: req.user?.id ?? null,
          requestId: req.requestId,
          endpointId: id,
        }),
      );
      context.auditWritten = true;
    }
    const pending = context?.pendingAudits ?? [];
    for (const write of pending) {
      try {
        await write();
      } catch (err) {
        logger.error({ err, endpointId: id }, "Optional audit write failed");
      }
    }
  };
  const middleware = [...before, ...extra, wrapped];
  switch (policy.method) {
    case "GET":
      app.get(policy.path, ...middleware);
      break;
    case "POST":
      app.post(policy.path, ...middleware);
      break;
    case "PATCH":
      app.patch(policy.path, ...middleware);
      break;
    case "DELETE":
      app.delete(policy.path, ...middleware);
      break;
  }
  mounted.add(id);
}

export function assertEndpointCoverage(): void {
  const methodPaths = new Set<string>();
  for (const id of Object.keys(endpointRegistry) as EndpointId[]) {
    if (
      !mounted.has(id) &&
      !(id.startsWith("upload.") && !env.UPLOAD_ENABLED)
    ) {
      throw new Error(`Endpoint is not mounted: ${id}`);
    }
    if (!mounted.has(id)) continue;
    const policy = endpointPolicy(id);
    const signature = `${policy.method} ${policy.path}`;
    if (methodPaths.has(signature))
      throw new Error(`Duplicate endpoint route: ${signature}`);
    methodPaths.add(signature);
  }
}
