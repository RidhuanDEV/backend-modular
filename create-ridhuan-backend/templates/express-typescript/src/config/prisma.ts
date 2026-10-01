import { PrismaClient } from "@prisma/client";
import { createDatabaseAdapter } from "./database-adapter.js";
import { env } from "./env.js";
import { logger } from "../core/logger/logger.js";

const adapter = createDatabaseAdapter(env.DATABASE_URL, env.DB_PROVIDER);

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: "event", level: "query" },
    { emit: "event", level: "error" },
  ],
});

prisma.$on("query", (e) => {
  logger.debug({ duration: e.duration, query: e.query }, "Prisma query");
});

prisma.$on("error", (e) => {
  logger.error({ message: e.message }, "Prisma error");
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info("Prisma disconnected");
}
