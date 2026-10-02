import { observed } from "../observability/telemetry";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/env.validation";
import { RedisService } from "../../platform/redis/redis.service";

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly redis: RedisService,
  ) {}

  private key(suffix: string): string {
    return `${this.config.get("REDIS_NAMESPACE", { infer: true })}:cache:v1:${suffix}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return observed("redis", async () => {
      if (!this.config.get("CACHE_ENABLED", { infer: true })) return undefined;
      try {
        const value = await this.redis.getClient()?.get(this.key(key));
        return value ? (JSON.parse(value) as T) : undefined;
      } catch (error) {
        this.logger.warn(
          `Cache read failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        return undefined;
      }
    });
  }

  async set<T>(key: string, value: T, seconds = 60): Promise<void> {
    return observed("redis", async () => {
      if (!this.config.get("CACHE_ENABLED", { infer: true })) return;
      try {
        await this.redis
          .getClient()
          ?.set(this.key(key), JSON.stringify(value), "EX", seconds);
      } catch (error) {
        this.logger.warn(
          `Cache write failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    });
  }

  async version(namespace: string): Promise<string | undefined> {
    return observed("redis", async () => {
      if (!this.config.get("CACHE_ENABLED", { infer: true })) return undefined;
      try {
        const client = this.redis.getClient();
        if (!client) return undefined;
        return (await client.get(this.key(`version:${namespace}`))) ?? "0";
      } catch {
        return undefined;
      }
    });
  }

  async invalidate(namespace: string): Promise<void> {
    return observed("redis", async () => {
      if (!this.config.get("CACHE_ENABLED", { infer: true })) return;
      try {
        const client = this.redis.getClient();
        if (!client) return;
        await client.incr(this.key(`version:${namespace}`));
      } catch (error) {
        this.logger.warn(
          `Cache invalidation failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    });
  }
}
