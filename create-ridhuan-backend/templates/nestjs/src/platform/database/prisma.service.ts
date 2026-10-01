import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDatabaseAdapter } from "./database-adapter";
import type { AppConfig } from "../../config/env.validation";
import { PrismaClient } from "../../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<AppConfig, true>) {
    super({ adapter: createDatabaseAdapter(config.get("DATABASE_URL", { infer: true }), config.get("DB_PROVIDER", { infer: true })) });
  }

  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
