import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { PageQueryDto } from "../../common/dto/pagination.dto";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type PaginationMeta, type Success } from "../../common/http/response";
import { CreateUserDto, UpdateUserDto, UserResponseDto } from "./dto/user.dto";
import { UsersService } from "./users.service";

@ApiTags("users") @ApiBearerAuth() @Controller("api/users")
export class UsersController {
  constructor(private readonly service: UsersService) {}
  @Get() @Endpoint("user.list")
  async list(@Query() query: PageQueryDto, @CurrentActor() actor: Actor): Promise<Success<Partial<UserResponseDto>[]> & { meta: PaginationMeta }> {
    const result = await this.service.list(query, actor); return { success: true, ...result };
  }
  @Get(":id") @Endpoint("user.get")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor): Promise<Success<UserResponseDto>> { return success(await this.service.get(id, actor)); }
  @Post() @Endpoint("user.create")
  async create(@Body() dto: CreateUserDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<UserResponseDto>> {
    return success(await this.service.create(dto, actor, req.requestId));
  }
  @Patch(":id") @Endpoint("user.update")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<UserResponseDto>> {
    return success(await this.service.update(id, dto, actor, req.requestId));
  }
  @Delete(":id") @HttpCode(204) @Endpoint("user.delete")
  async delete(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<void> { await this.service.delete(id, actor, req.requestId); }
}
