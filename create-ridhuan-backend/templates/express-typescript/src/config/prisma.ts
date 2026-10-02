import { PrismaClient } from "@prisma/client";
import { createDatabaseAdapter } from "./database-adapter.js";
import { env } from "./env.js";
import { logger } from "../core/logger/logger.js";
import {
  databaseDuration,
  shutdownTelemetry,
} from "../core/observability/telemetry.js";

const adapter = createDatabaseAdapter(env.DATABASE_URL, env.DB_PROVIDER);

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("query", (e) => {
  databaseDuration(e.duration);
  logger.debug({ duration: e.duration }, "Database operation completed");
});

prisma.$on("error", () => {
  logger.error("Database operation failed");
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await shutdownTelemetry();
  logger.info("Prisma disconnected");
}
