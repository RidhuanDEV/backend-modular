import type { ZodType } from "zod";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../logger/logger.js";
import { currentEndpoint } from "../http/endpoint-context.js";
import { endpointPolicy } from "../http/endpoint-registry.js";

export class CacheService {
  constructor(
    private readonly prefix = "cache",
    private readonly respectEndpointPolicy = true,
  ) {}
  private key(key: string): string {
    return `${env.REDIS_NAMESPACE}:${this.prefix}:${key}`;
  }
  private allowed(): boolean {
    const context = currentEndpoint();
    return (
      !this.respectEndpointPolicy ||
      !context ||
      endpointPolicy(context.endpointId).cache === "read"
    );
  }

  async get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
    if (!env.CACHE_ENABLED || !redis || !this.allowed()) return null;
    try {
      const raw = await redis.get(this.key(key));
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : null;
    } catch (err) {
      logger.warn({ err, key }, "Cache read failed; using database");
      return null;
    }
  }

  async set(key: string, value: unknown, ttl = 300): Promise<void> {
    if (!env.CACHE_ENABLED || !redis || !this.allowed()) return;
    try {
      await redis.set(this.key(key), JSON.stringify(value), "EX", ttl);
    } catch (err) {
      logger.warn({ err, key }, "Cache write failed");
    }
  }

  async del(key: string): Promise<void> {
    if (!env.CACHE_ENABLED || !redis) return;
    try {
      await redis.del(this.key(key));
    } catch (err) {
      logger.warn({ err, key }, "Cache delete failed");
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!env.CACHE_ENABLED || !redis) return;
    try {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          this.key(pattern),
          "COUNT",
          100,
        );
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== "0");
    } catch (err) {
      logger.warn({ err, pattern }, "Cache invalidation failed");
    }
  }
}

export const cacheService = new CacheService();
