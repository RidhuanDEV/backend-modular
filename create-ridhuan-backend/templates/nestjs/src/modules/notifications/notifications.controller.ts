import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Sse } from "@nestjs/common";
import { ApiBearerAuth, ApiProduces, ApiTags } from "@nestjs/swagger";
import { concatMap, from, interval, map, merge, mergeMap, startWith, takeUntil, timer, type Observable } from "rxjs";
import type { MessageEvent } from "@nestjs/common";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type Success } from "../../common/http/response";
import { CreateNotificationDto, NotificationResponseDto } from "./dto/notification.dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications") @ApiBearerAuth() @Controller("api/notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post() @Endpoint("notification.create")
  async create(@Body() input: CreateNotificationDto, @CurrentActor() actor: Actor,
    @Req() request: ApiRequest): Promise<Success<NotificationResponseDto>> {
    return success(await this.service.create(input, actor, request.requestId));
  }

  @Get() @Endpoint("notification.list")
  async list(@CurrentActor() actor: Actor): Promise<Success<NotificationResponseDto[]>> {
    return success(await this.service.list(actor));
  }

  @Patch(":id/read") @HttpCode(200) @Endpoint("notification.read")
  async read(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor,
    @Req() request: ApiRequest): Promise<Success<NotificationResponseDto>> {
    return success(await this.service.markRead(id, actor, request.requestId));
  }

  @Sse("stream") @ApiProduces("text/event-stream") @Endpoint("notification.stream")
  stream(@CurrentActor() actor: Actor, @Req() request: ApiRequest): Observable<MessageEvent> {
    const sent = new Set<string>();
    const events = interval(3000).pipe(startWith(0), concatMap(async () => {
      const values = await this.service.unread(actor);
      return values.filter((value) => !sent.has(value.id));
    }), mergeMap((values) => from(values.map((value): MessageEvent => {
      sent.add(value.id);
      return { id: value.id, type: "notification", data: value };
    }))));
    const heartbeat = interval(15000).pipe(map((): MessageEvent => ({ type: "heartbeat", data: {} })));
    const remaining = Math.max(0, (request.accessExpiresAt ?? Date.now()) - Date.now());
    return merge(events, heartbeat).pipe(takeUntil(timer(Math.min(14 * 60 * 1000, remaining))));
  }
}
