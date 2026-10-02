import type { RequestHandler } from "express";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";
import { sendSuccess } from "../../utils/response.js";

export interface ReadinessDependencies {
  database: () => Promise<unknown>;
  rateStore?: () => Promise<unknown>;
}

export async function checkReadiness(dependencies: ReadinessDependencies, timeoutMs = 1000): Promise<boolean> {
  const checks = [dependencies.database(), ...(dependencies.rateStore ? [dependencies.rateStore()] : [])];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(checks).then(() => true).catch((error: unknown) => {
        logger.warn({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Readiness dependency failed");
        return false;
      }),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createReadinessHandler(dependencies: ReadinessDependencies): RequestHandler {
  return async (_req, res) => {
    if (!(await checkReadiness(dependencies))) {
      res.status(503).json({ success: false, message: "Service unavailable", errors: [] });
      return;
    }
    sendSuccess(res, { data: { status: "ok" } });
  };
}

export const readinessHandler = createReadinessHandler({
  database: () => prisma.$queryRaw`SELECT 1`,
  ...(env.RATE_LIMIT_STORE === "redis" ? {
    rateStore: () => redis ? redis.ping() : Promise.reject(new Error("Redis rate store unavailable")),
  } : {}),
});
