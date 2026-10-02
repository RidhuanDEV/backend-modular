import "../config/load-env";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { EmailWorkerModule } from "../platform/jobs/email-worker.module";
import type { AppConfig } from "../config/env.validation";
import { PrismaService } from "../platform/database/prisma.service";
import { MailService } from "../platform/mail/mail.service";
import {
  runEmailWorker,
  waitForWorkerShutdown,
} from "../platform/jobs/operations";
import { validateEnvironment } from "../config/env.validation";
import { shutdownTelemetry } from "../common/observability/telemetry";

async function main(): Promise<void> {
  if (!validateEnvironment(process.env).SMTP_ENABLED) {
    new Logger("EmailWorker").log(
      "SMTP disabled; worker is idle until shutdown",
    );
    await waitForWorkerShutdown();
    await shutdownTelemetry();
    return;
  }
  const app = await NestFactory.createApplicationContext(EmailWorkerModule);
  const logger = new Logger("EmailWorker");
  try {
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    const mail = app.get(MailService);
    await runEmailWorker(
      app.get(PrismaService),
      config.get("DB_PROVIDER", { infer: true }),
      config.get("SMTP_ENABLED", { infer: true }),
      (payload) =>
        mail.send({
          to: payload.recipient,
          subject: payload.title,
          text: payload.body,
        }),
      (message, jobId) => logger.log({ message, jobId }),
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  new Logger("EmailWorker").error("Worker stopped unexpectedly");
  process.exitCode = 1;
});
