import "./config/load-env";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { CommonModule } from "./common/common.module";
import { AccessGuard, PreAuthRateGuard } from "./common/auth/access.guard";
import { ReadAuditInterceptor } from "./common/audit/read-audit.interceptor";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";
import { validateEnvironment } from "./config/env.validation";
import { AuthModule } from "./modules/auth/auth.module";
import { DocsModule } from "./modules/docs/docs.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { RolesModule } from "./modules/roles/roles.module";
import { SystemModule } from "./modules/system/system.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersModule } from "./modules/users/users.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { DatabaseModule } from "./platform/database/database.module";
import { RedisModule } from "./platform/redis/redis.module";
import { MailModule } from "./platform/mail/mail.module";
import { SseModule } from "./platform/sse/sse.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnvironment }), CommonModule,
    DatabaseModule, RedisModule, MailModule, SseModule, SystemModule, DocsModule, AuthModule, UsersModule,
    RolesModule, PermissionsModule, UploadsModule, NotificationsModule],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: PreAuthRateGuard }, { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: ReadAuditInterceptor }],
})
export class AppModule {}
