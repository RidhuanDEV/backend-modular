import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { PageQueryDto } from "../../common/dto/pagination.dto";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type PaginationMeta, type Success } from "../../common/http/response";
import { CreatePermissionDto, PermissionResponseDto, UpdatePermissionDto } from "./dto/permission.dto";
import { PermissionsService } from "./permissions.service";

@ApiTags("permissions") @ApiBearerAuth() @Controller("api/permissions")
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}
  @Get() @Endpoint("permission.list")
  async list(@Query() query: PageQueryDto): Promise<Success<PermissionResponseDto[]> & { meta: PaginationMeta }> {
    const result = await this.service.list(query); return { success: true, ...result };
  }
  @Get(":id") @Endpoint("permission.get")
  async get(@Param("id", ParseUUIDPipe) id: string): Promise<Success<PermissionResponseDto>> { return success(await this.service.get(id)); }
  @Post() @Endpoint("permission.create")
  async create(@Body() dto: CreatePermissionDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<PermissionResponseDto>> {
    return success(await this.service.create(dto, actor, req.requestId));
  }
  @Patch(":id") @Endpoint("permission.update")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePermissionDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<PermissionResponseDto>> {
    return success(await this.service.update(id, dto, actor, req.requestId));
  }
  @Delete(":id") @HttpCode(204) @Endpoint("permission.delete")
  async delete(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<void> { await this.service.delete(id, actor, req.requestId); }
}
