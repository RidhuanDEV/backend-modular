import "../config/load-env.js";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { prisma, disconnectPrisma } from "../config/prisma.js";
import { logger } from "../core/logger/logger.js";
import { runEmailWorker } from "../core/jobs/operations.js";

try {
  await runEmailWorker(
    prisma,
    env.DB_PROVIDER,
    env.SMTP_ENABLED,
    async (payload) => {
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        ...(env.SMTP_USER && env.SMTP_PASSWORD
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          transport.sendMail({
            from: env.SMTP_FROM,
            to: payload.recipient,
            subject: payload.title,
            text: payload.body,
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              transport.close();
              reject(new Error("SMTP delivery deadline exceeded"));
            }, 25_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        transport.close();
      }
    },
    (message, jobId) => logger.info({ jobId }, message),
  );
} catch {
  logger.error("Email worker stopped unexpectedly");
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
