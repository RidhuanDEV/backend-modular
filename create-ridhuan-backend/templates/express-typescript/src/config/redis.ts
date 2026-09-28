import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "../core/logger/logger.js";

export const redis: Redis | null = env.REDIS_URL && (env.CACHE_ENABLED || env.RATE_LIMIT_STORE === "redis") ? new Redis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  connectTimeout: 1000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
}) : null;

redis?.on("connect", () => logger.info("Redis connected"));
redis?.on("error", (err: Error) =>
  logger.error({ err }, "Redis connection error"),
);
