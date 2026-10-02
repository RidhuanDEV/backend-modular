import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDatabaseAdapter } from "./database-adapter";
import type { AppConfig } from "../../config/env.validation";
import { PrismaClient, type Prisma } from "../../generated/prisma/client";
import {
  databaseDuration,
  shutdownTelemetry,
} from "../../common/observability/telemetry";

type QueryClientOptions = Prisma.PrismaClientOptions & {
  log: [{ emit: "event"; level: "query" }];
};

@Injectable()
export class PrismaService
  extends PrismaClient<QueryClientOptions, "query">
  implements OnModuleDestroy
{
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      adapter: createDatabaseAdapter(
        config.get("DATABASE_URL", { infer: true }),
        config.get("DB_PROVIDER", { infer: true }),
      ),
      log: [{ emit: "event", level: "query" }],
    });
    this.$on("query", (event) => databaseDuration(event.duration));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await shutdownTelemetry();
  }
}
