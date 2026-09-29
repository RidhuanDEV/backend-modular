import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../platform/database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { CacheService } from "../../common/cache/cache.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { pagination, type PaginationMeta } from "../../common/http/response";
import type { PageQueryDto } from "../../common/dto/pagination.dto";
import type { AssignPermissionsDto, CreateRoleDto, RoleResponseDto, UpdateRoleDto } from "./dto/role.dto";

const include = { permissions: { include: { permission: true } } } as const;
type RoleRecord = Prisma.RoleGetPayload<{ include: typeof include }>;
function mapRole(value: RoleRecord): RoleResponseDto {
  return { id: value.id, name: value.name, permissions: value.permissions.map((item) => ({ id: item.permission.id, name: item.permission.name })),
    createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService, private readonly cache: CacheService) {}

  async list(query: PageQueryDto): Promise<{ data: RoleResponseDto[]; meta: PaginationMeta }> {
    const version = await this.cache.version("roles");
    const key = `roles:${version}:list:${JSON.stringify(query)}`;
    if (version && this.policy.for("role.list").cache === "read") {
      const cached = await this.cache.get<{ data: RoleResponseDto[]; meta: PaginationMeta }>(key);
      if (cached) return cached;
    }
    const where: Prisma.RoleWhereInput = query.search ? { name: { contains: query.search, mode: "insensitive" } } : {};
    const sortBy = ["name", "createdAt", "updatedAt"].includes(query.sortBy) ? query.sortBy : "createdAt";
    const [items, total] = await this.prisma.$transaction([
      this.prisma.role.findMany({ where, include, skip: (query.page - 1) * query.limit, take: query.limit,
        orderBy: { [sortBy]: query.orderBy } }), this.prisma.role.count({ where }),
    ]);
    const result = { data: items.map(mapRole), meta: pagination(query.page, query.limit, total) };
    if (version && this.policy.for("role.list").cache === "read") await this.cache.set(key, result);
    return result;
  }
  async get(id: string): Promise<RoleResponseDto> {
    const version = await this.cache.version("roles");
    const key = `roles:${version}:get:${id}`;
    if (version && this.policy.for("role.get").cache === "read") {
      const cached = await this.cache.get<RoleResponseDto>(key);
      if (cached) return cached;
    }
    const item = await this.prisma.role.findUnique({ where: { id }, include });
    if (!item) throw new NotFoundException("Role not found");
    const result = mapRole(item);
    if (version && this.policy.for("role.get").cache === "read") await this.cache.set(key, result);
    return result;
  }
  async create(dto: CreateRoleDto, actor: Actor, requestId?: string): Promise<RoleResponseDto> {
    const item = await this.audit.transact(async (tx) => {
      const value = await tx.role.create({ data: { name: dto.name }, include });
      return [value, { endpointId: "role.create", policy: this.policy.for("role.create"), actor, behavior: "created",
        module: "roles", entityId: value.id, after: { id: value.id, name: value.name }, ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("roles");
    return mapRole(item);
  }
  async update(id: string, dto: UpdateRoleDto, actor: Actor, requestId?: string): Promise<RoleResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.role.findUnique({ where: { id }, include });
      if (!prior) throw new NotFoundException("Role not found");
      const next = await tx.role.update({ where: { id }, data: { ...(dto.name !== undefined ? { name: dto.name } : {}) }, include });
      return [next, { endpointId: "role.update", policy: this.policy.for("role.update"), actor, behavior: "updated", module: "roles",
        entityId: id, before: { id, name: prior.name }, after: { id, name: next.name }, ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("roles");
    await this.cache.invalidate("users");
    return mapRole(value);
  }
  async delete(id: string, actor: Actor, requestId?: string): Promise<void> {
    await this.audit.transact(async (tx) => {
      const prior = await tx.role.findUnique({ where: { id } });
      if (!prior) throw new NotFoundException("Role not found");
      await tx.role.delete({ where: { id } });
      return [undefined, { endpointId: "role.delete", policy: this.policy.for("role.delete"), actor, behavior: "deleted",
        module: "roles", entityId: id, before: { id, name: prior.name }, ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("roles");
    await this.cache.invalidate("users");
  }
  async assign(id: string, dto: AssignPermissionsDto, actor: Actor, requestId?: string): Promise<RoleResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.role.findUnique({ where: { id }, include });
      if (!prior) throw new NotFoundException("Role not found");
      const count = await tx.permission.count({ where: { id: { in: dto.permissionIds } } });
      if (count !== new Set(dto.permissionIds).size) throw new NotFoundException("Permission not found");
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: [...new Set(dto.permissionIds)].map((permissionId) => ({ roleId: id, permissionId })) });
      const next = await tx.role.findUniqueOrThrow({ where: { id }, include });
      return [next, { endpointId: "role.assignPermissions", policy: this.policy.for("role.assignPermissions"), actor,
        behavior: "permissions_assigned", module: "roles", entityId: id,
        before: { permissionIds: prior.permissions.map((item) => item.permissionId) }, after: { permissionIds: dto.permissionIds },
        ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("roles");
    await this.cache.invalidate("users");
    return mapRole(value);
  }
}
