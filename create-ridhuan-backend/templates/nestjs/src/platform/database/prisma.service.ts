import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AppConfig } from "../../config/env.validation";
import { PrismaClient } from "../../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<AppConfig, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get("DATABASE_URL", { infer: true }), connectionTimeoutMillis: 2000, options: "-c timezone=UTC" }) });
  }

  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
