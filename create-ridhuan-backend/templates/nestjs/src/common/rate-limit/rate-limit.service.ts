import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/env.validation";
import type { RateGroup } from "../endpoint/endpoint.registry";
import { RedisService } from "../../platform/redis/redis.service";

interface Counter { count: number; expiresAt: number; }
const LUA = "local hits = redis.call('INCR', KEYS[1]); if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return hits";

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly config: ConfigService<AppConfig, true>, private readonly redis: RedisService) {}

  private settings(group: RateGroup): { windowMs: number; max: number } {
    if (group === "auth") return {
      windowMs: this.config.get("RATE_LIMIT_AUTH_WINDOW_MS", { infer: true }),
      max: this.config.get("RATE_LIMIT_AUTH_MAX", { infer: true }),
    };
    if (group === "public") return {
      windowMs: this.config.get("RATE_LIMIT_PUBLIC_WINDOW_MS", { infer: true }),
      max: this.config.get("RATE_LIMIT_PUBLIC_MAX", { infer: true }),
    };
    return {
      windowMs: this.config.get("RATE_LIMIT_INTERNAL_WINDOW_MS", { infer: true }),
      max: this.config.get("RATE_LIMIT_INTERNAL_MAX", { infer: true }),
    };
  }

  async consume(group: RateGroup, subject: string): Promise<void> {
    const { windowMs, max } = this.settings(group);
    const bucket = Math.floor(Date.now() / windowMs);
    const namespace = this.config.get("REDIS_NAMESPACE", { infer: true });
    const key = `${namespace}:rate:${group}:${subject}:${bucket}`;
    let hits: number;
    if (this.config.get("RATE_LIMIT_STORE", { infer: true }) === "redis") {
      try {
        const client = this.redis.getClient();
        if (!client) throw new Error("Redis client unavailable");
        const value = await client.eval(LUA, 1, key, String(windowMs), String(max));
        hits = Number(value);
        if (!Number.isFinite(hits)) throw new Error("Invalid Redis limiter result");
      } catch (error) {
        this.logger.warn(`Redis rate limit unavailable for ${group}: ${error instanceof Error ? error.message : "unknown"}`);
        if (group === "auth") throw new ServiceUnavailableException("Authentication rate limit unavailable");
        return;
      }
    } else {
      const existing = this.counters.get(key);
      const current = existing && existing.expiresAt > Date.now() ? existing : { count: 0, expiresAt: Date.now() + windowMs };
      current.count += 1;
      this.counters.set(key, current);
      hits = current.count;
      if (this.counters.size > 10000) {
        for (const [oldKey, value] of this.counters) if (value.expiresAt <= Date.now()) this.counters.delete(oldKey);
      }
    }
    if (hits > max) throw new HttpException("Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
  }
}
