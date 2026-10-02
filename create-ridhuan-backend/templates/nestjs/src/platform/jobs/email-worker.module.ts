import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "../../config/env.validation";
import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";

/** Email delivery requires PostgreSQL/MySQL and SMTP; no HTTP guards or Redis clients. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    MailModule,
  ],
})
export class EmailWorkerModule {}
