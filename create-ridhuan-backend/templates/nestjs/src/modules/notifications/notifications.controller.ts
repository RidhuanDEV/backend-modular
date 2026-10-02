import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { serveNotifications } from "../../common/http/notification-stream";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type Success } from "../../common/http/response";
import {
  CreateNotificationDto,
  NotificationResponseDto,
  NotificationQueryDto,
} from "./dto/notification.dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("api/notifications")
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);
  constructor(private readonly service: NotificationsService) {}

  @Post()
  @Endpoint("notification.create")
  async create(
    @Body() input: CreateNotificationDto,
    @CurrentActor() actor: Actor,
    @Req() request: ApiRequest,
  ): Promise<Success<NotificationResponseDto>> {
    return success(await this.service.create(input, actor, request.requestId));
  }

  @Get()
  @Endpoint("notification.list")
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: NotificationQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Success<NotificationResponseDto[]>> {
    const page = await this.service.listPage(actor, query.cursor);
    if (page.next) response.setHeader("X-Next-Cursor", page.next);
    return success(page.items);
  }

  @Patch(":id/read")
  @HttpCode(200)
  @Endpoint("notification.read")
  async read(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Req() request: ApiRequest,
  ): Promise<Success<NotificationResponseDto>> {
    return success(await this.service.markRead(id, actor, request.requestId));
  }

  @Get("stream")
  @ApiProduces("text/event-stream")
  @Endpoint("notification.stream")
  @ApiHeader({
    name: "Last-Event-ID",
    required: false,
    description: "UUID of this recipient's last notification",
  })
  async stream(
    @CurrentActor() actor: Actor,
    @Req() request: ApiRequest,
    @Res() response: Response,
  ): Promise<void> {
    const cursor = await this.service.cursor(
      actor,
      request.get("Last-Event-ID"),
    );
    await serveNotifications(
      response,
      cursor,
      request.accessExpiresAt ?? Date.now(),
      (after) => this.service.streamBatch(actor, after, cursor === undefined),
      () => this.logger.warn("Notification stream unavailable"),
    );
  }
}
