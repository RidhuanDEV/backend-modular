import { textSearchPage } from "../../platform/database/text-search";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Permission } from "../../generated/prisma/client";
import { AuditService } from "../../common/audit/audit.service";
import { CacheService } from "../../common/cache/cache.service";
import type { PageQueryDto } from "../../common/dto/pagination.dto";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { pagination, type PaginationMeta } from "../../common/http/response";
import { PrismaService } from "../../platform/database/prisma.service";
import type {
  CreatePermissionDto,
  PermissionResponseDto,
  UpdatePermissionDto,
} from "./dto/permission.dto";

function mapPermission(value: Permission): PermissionResponseDto {
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService,
    private readonly cache: CacheService,
  ) {}
  async list(
    query: PageQueryDto,
  ): Promise<{ data: PermissionResponseDto[]; meta: PaginationMeta }> {
    const version = await this.cache.version("permissions");
    const key = `permissions:${version}:list:${JSON.stringify(query)}`;
    if (version && this.policy.for("permission.list").cache === "read") {
      const cached = await this.cache.get<{
        data: PermissionResponseDto[];
        meta: PaginationMeta;
      }>(key);
      if (cached) return cached;
    }
    const matches = query.search
      ? await textSearchPage(this.prisma, "permissions", query)
      : undefined;
    const where: Prisma.PermissionWhereInput = {
      ...(matches ? { id: { in: matches.ids } } : {}),
    };
    const sortBy = ["name", "createdAt", "updatedAt"].includes(query.sortBy)
      ? query.sortBy
      : "createdAt";
    const [items, pageCount] = await this.prisma.$transaction([
      this.prisma.permission.findMany({
        where,
        skip: matches ? 0 : (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [sortBy]: query.orderBy }, { id: "asc" }],
      }),
      this.prisma.permission.count({ where }),
    ]);
    const total = matches?.total ?? pageCount;
    const result = {
      data: items.map(mapPermission),
      meta: pagination(query.page, query.limit, total),
    };
    if (version && this.policy.for("permission.list").cache === "read")
      await this.cache.set(key, result);
    return result;
  }
  async get(id: string): Promise<PermissionResponseDto> {
    const version = await this.cache.version("permissions");
    const key = `permissions:${version}:get:${id}`;
    if (version && this.policy.for("permission.get").cache === "read") {
      const cached = await this.cache.get<PermissionResponseDto>(key);
      if (cached) return cached;
    }
    const value = await this.prisma.permission.findUnique({ where: { id } });
    if (!value) throw new NotFoundException("Permission not found");
    const result = mapPermission(value);
    if (version && this.policy.for("permission.get").cache === "read")
      await this.cache.set(key, result);
    return result;
  }
  async create(
    dto: CreatePermissionDto,
    actor: Actor,
    requestId?: string,
  ): Promise<PermissionResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const next = await tx.permission.create({ data: { name: dto.name } });
      return [
        next,
        {
          endpointId: "permission.create",
          policy: this.policy.for("permission.create"),
          actor,
          behavior: "created",
          module: "permissions",
          entityId: next.id,
          after: { id: next.id, name: next.name },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    await this.cache.invalidate("permissions");
    return mapPermission(value);
  }
  async update(
    id: string,
    dto: UpdatePermissionDto,
    actor: Actor,
    requestId?: string,
  ): Promise<PermissionResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.permission.findUnique({ where: { id } });
      if (!prior) throw new NotFoundException("Permission not found");
      const next = await tx.permission.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}) },
      });
      return [
        next,
        {
          endpointId: "permission.update",
          policy: this.policy.for("permission.update"),
          actor,
          behavior: "updated",
          module: "permissions",
          entityId: id,
          before: { id, name: prior.name },
          after: { id, name: next.name },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    await this.cache.invalidate("permissions");
    await this.cache.invalidate("roles");
    await this.cache.invalidate("users");
    return mapPermission(value);
  }
  async delete(id: string, actor: Actor, requestId?: string): Promise<void> {
    await this.audit.transact(async (tx) => {
      const prior = await tx.permission.findUnique({ where: { id } });
      if (!prior) throw new NotFoundException("Permission not found");
      await tx.permission.delete({ where: { id } });
      return [
        undefined,
        {
          endpointId: "permission.delete",
          policy: this.policy.for("permission.delete"),
          actor,
          behavior: "deleted",
          module: "permissions",
          entityId: id,
          before: { id, name: prior.name },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    await this.cache.invalidate("permissions");
    await this.cache.invalidate("roles");
    await this.cache.invalidate("users");
  }
}
