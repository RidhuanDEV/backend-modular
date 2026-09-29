import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { AppConfig } from "../../config/env.validation";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import { success, type Success } from "../../common/http/response";
import { PrismaService } from "../../platform/database/prisma.service";
import { RedisService } from "../../platform/redis/redis.service";

@ApiTags("system") @Controller()
export class SystemController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService,
    private readonly config: ConfigService<AppConfig, true>) {}
  @Get("health") @Endpoint("health.get")
  health(): Success<{ status: string }> { return success({ status: "ok" }); }
  @Get("live") @Endpoint("live.get")
  live(): Success<{ status: string }> { return success({ status: "live" }); }
  @Get("ready") @Endpoint("ready.get")
  async ready(): Promise<Success<{ status: string }>> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.config.get("RATE_LIMIT_STORE", { infer: true }) === "redis" && !(await this.redis.ping())) throw new Error("Redis unavailable");
      return success({ status: "ready" });
    } catch { throw new HttpException("Dependency unavailable", HttpStatus.SERVICE_UNAVAILABLE); }
  }
}
