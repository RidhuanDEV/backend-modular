import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { MailModule } from "../../platform/mail/mail.module";

@Module({ imports: [MailModule], controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
