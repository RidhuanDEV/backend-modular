import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "./env.js";
import { logger } from "../core/logger/logger.js";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  options: "-c timezone=UTC",
  connectionTimeoutMillis: 3000,
});

const adapter = new PrismaPg(pool);

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
  await pool.end();
  logger.info("Prisma disconnected");
}
