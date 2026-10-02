import { observed } from "../../common/observability/telemetry";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { AppConfig } from "../../config/env.validation";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;
  private readonly required: boolean;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.required = config.get("RATE_LIMIT_STORE", { infer: true }) === "redis";
    this.enabled =
      this.required || config.get("CACHE_ENABLED", { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const url = this.config.get("REDIS_URL", { infer: true });
    if (!url) throw new Error("REDIS_URL is required");
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    try {
      await this.client.connect();
    } catch (error) {
      if (this.required) throw error;
      this.logger.warn("Optional cache Redis unavailable at startup");
    }
  }

  getClient(): Redis | undefined {
    return this.client;
  }

  async ping(): Promise<boolean> {
    return observed("redis", async () => {
      if (!this.client || this.client.status !== "ready") return false;
      try {
        return (await this.client.ping()) === "PONG";
      } catch {
        return false;
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    if (this.client.status === "ready") await this.client.quit();
    else this.client.disconnect();
  }
}
