import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { PageQueryDto } from "../../common/dto/pagination.dto";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type PaginationMeta, type Success } from "../../common/http/response";
import { AssignPermissionsDto, CreateRoleDto, RoleResponseDto, UpdateRoleDto } from "./dto/role.dto";
import { RolesService } from "./roles.service";

@ApiTags("roles") @ApiBearerAuth() @Controller("api/roles")
export class RolesController {
  constructor(private readonly service: RolesService) {}
  @Get() @Endpoint("role.list")
  async list(@Query() query: PageQueryDto): Promise<Success<RoleResponseDto[]> & { meta: PaginationMeta }> {
    const result = await this.service.list(query); return { success: true, ...result };
  }
  @Get(":id") @Endpoint("role.get")
  async get(@Param("id", ParseUUIDPipe) id: string): Promise<Success<RoleResponseDto>> { return success(await this.service.get(id)); }
  @Post() @Endpoint("role.create")
  async create(@Body() dto: CreateRoleDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<RoleResponseDto>> {
    return success(await this.service.create(dto, actor, req.requestId));
  }
  @Patch(":id") @Endpoint("role.update")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<RoleResponseDto>> {
    return success(await this.service.update(id, dto, actor, req.requestId));
  }
  @Delete(":id") @HttpCode(204) @Endpoint("role.delete")
  async delete(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<void> { await this.service.delete(id, actor, req.requestId); }
  @Post(":id/permissions") @HttpCode(200) @Endpoint("role.assignPermissions")
  async assign(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AssignPermissionsDto, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<RoleResponseDto>> {
    return success(await this.service.assign(id, dto, actor, req.requestId));
  }
}
