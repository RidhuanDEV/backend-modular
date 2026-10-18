import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import type { RedisReply } from "rate-limit-redis";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { observed } from "../observability/telemetry.js";
import type { Request } from "express";

function isRedisData(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export type RateLimitGroup = "auth" | "public" | "internal";

const policies = {
  auth: {
    windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
    limit: env.RATE_LIMIT_AUTH_MAX,
  },
  public: {
    windowMs: env.RATE_LIMIT_PUBLIC_WINDOW_MS,
    limit: env.RATE_LIMIT_PUBLIC_MAX,
  },
  internal: {
    windowMs: env.RATE_LIMIT_INTERNAL_WINDOW_MS,
    limit: env.RATE_LIMIT_INTERNAL_MAX,
  },
} satisfies Record<RateLimitGroup, { windowMs: number; limit: number }>;

function createLimiter(
  group: RateLimitGroup,
  bucket: string = group,
  accountKey?: (req: Request) => string | undefined,
): RateLimitRequestHandler {
  const config = policies[group];
  const store =
    env.RATE_LIMIT_STORE === "redis" && redis
      ? new RedisStore({
          prefix: `${env.REDIS_NAMESPACE}:rate:${bucket}:`,
          sendCommand: async (...args: string[]): Promise<RedisReply> => {
            if (!redis)
              throw new Error("Redis rate limit store is unavailable");
            const command = args[0];
            if (!command) throw new Error("Missing Redis command");
            const connection = redis;
            const reply = await observed("redis", () =>
              connection.call(command, ...args.slice(1)),
            );
            if (isRedisData(reply)) return reply;
            if (Array.isArray(reply) && reply.every(isRedisData)) return reply;
            throw new Error("Unsupported Redis rate limit reply");
          },
        })
      : undefined;
  return rateLimit({
    ...(store ? { store } : {}),
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) =>
      group === "public" && ["/health", "/live", "/ready"].includes(req.path),
    passOnStoreError: group !== "auth",
    keyGenerator: (req) => {
      const account = accountKey?.(req);
      if (account !== undefined) return `account:${account}`;
      return group === "internal" && req.user
        ? `user:${req.user.id}`
        : ipKeyGenerator(req.ip ?? "127.0.0.1");
    },
    message: { success: false, message: "Too many requests", errors: [] },
  });
}

const limiters: Record<RateLimitGroup, RateLimitRequestHandler> = {
  auth: createLimiter("auth"),
  public: createLimiter("public"),
  internal: createLimiter("internal"),
};

export function rateLimiter(group: RateLimitGroup): RateLimitRequestHandler {
  return limiters[group];
}

/**
 * Login attempts per target account, on top of the per-IP auth limit, so
 * credential stuffing spread across many IPs still hits a ceiling.
 */
export const loginAccountLimiter = createLimiter(
  "auth",
  "auth-account",
  (req) => {
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null) return undefined;
    const email = (body as { email?: unknown }).email;
    return typeof email === "string" ? email : undefined;
  },
);
