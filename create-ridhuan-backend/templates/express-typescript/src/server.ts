import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma, disconnectPrisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { closeQueues } from "./core/queue/queue.service.js";
import { logger } from "./core/logger/logger.js";

// Global process exception and unhandled rejection event boundaries
process.on("uncaughtException", (err: Error) => {
  logger.fatal({ err }, "Uncaught Exception detected — shutting down process");
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.fatal(
    { reason },
    "Unhandled Rejection detected — shutting down process",
  );
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  await prisma.$connect();
  logger.info("Database connected");

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server started");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Graceful shutdown initiated");

    server.close(async () => {
      await closeQueues();
      await disconnectPrisma();
      redis?.disconnect();
      logger.info("Server shut down");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced shutdown — timeout exceeded");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
