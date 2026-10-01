import { textSearchPage } from "../../platform/database/text-search";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import bcrypt from "bcrypt";
import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "../../common/audit/audit.service";
import { CacheService } from "../../common/cache/cache.service";
import { fieldsAllowed, type PageQueryDto } from "../../common/dto/pagination.dto";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { pagination, type PaginationMeta } from "../../common/http/response";
import { PrismaService } from "../../platform/database/prisma.service";
import type { CreateUserDto, UpdateUserDto, UserResponseDto } from "./dto/user.dto";
import { assertRoleWithinActor } from "../../common/auth/privilege";

const include = { role: { include: { permissions: { include: { permission: true } } } } } as const;
type UserRecord = Prisma.UserGetPayload<{ include: typeof include }>;
function mapUser(value: UserRecord): UserResponseDto {
  return { id: value.id, email: value.email, roleId: value.roleId,
    role: { id: value.role.id, name: value.role.name, permissions: value.role.permissions.map((grant) => ({ id: grant.permission.id, name: grant.permission.name })) },
    createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() };
}
function project(value: UserResponseDto, fields: readonly string[] | undefined): Partial<UserResponseDto> {
  if (!fields) return value;
  const selected: Partial<UserResponseDto> = {};
  for (const field of fields) {
    if (field === "id") selected.id = value.id;
    if (field === "email") selected.email = value.email;
    if (field === "roleId") selected.roleId = value.roleId;
  }
  return selected;
}
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService, private readonly cache: CacheService) {}

  async list(query: PageQueryDto, actor: Actor): Promise<{ data: Partial<UserResponseDto>[]; meta: PaginationMeta }> {
    const fields = fieldsAllowed(query.fields, ["id", "email", "roleId"]);
    const version = await this.cache.version("users");
    const key = `users:${version}:list:${actor.id}:${JSON.stringify(query)}`;
    if (version && this.policy.for("user.list").cache === "read") {
      const cached = await this.cache.get<{ data: Partial<UserResponseDto>[]; meta: PaginationMeta }>(key);
      if (cached) return cached;
    }
    const matches = query.search ? await textSearchPage(this.prisma, "users", query) : undefined;
    const where: Prisma.UserWhereInput = { deletedAt: null, ...(matches ? { id: { in: matches.ids } } : {}) };
    const sortBy = ["createdAt", "updatedAt", "email"].includes(query.sortBy) ? query.sortBy : "createdAt";
    const [items, pageCount] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include, skip: matches ? 0 : (query.page - 1) * query.limit, take: query.limit,
        orderBy: [{ [sortBy]: query.orderBy }, { id: "asc" }] }), this.prisma.user.count({ where }),
    ]);
    const total = matches?.total ?? pageCount;
    const result = { data: items.map((item) => project(mapUser(item), fields)), meta: pagination(query.page, query.limit, total) };
    if (version && this.policy.for("user.list").cache === "read") await this.cache.set(key, result);
    return result;
  }
  async get(id: string, actor: Actor): Promise<UserResponseDto> {
    const version = await this.cache.version("users");
    const key = `users:${version}:get:${actor.id}:${id}`;
    if (version && this.policy.for("user.get").cache === "read") {
      const cached = await this.cache.get<UserResponseDto>(key); if (cached) return cached;
    }
    const value = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include });
    if (!value) throw new NotFoundException("User not found");
    const result = mapUser(value);
    if (version && this.policy.for("user.get").cache === "read") await this.cache.set(key, result, 120);
    return result;
  }
  async create(dto: CreateUserDto, actor: Actor, requestId?: string): Promise<UserResponseDto> {
    const password = await bcrypt.hash(dto.password, 12);
    const value = await this.audit.transact(async (tx) => {
      await assertRoleWithinActor(tx, actor.roleId, dto.roleId);
      const next = await tx.user.create({ data: { email: dto.email.trim().toLowerCase(), password, roleId: dto.roleId }, include });
      return [next, { endpointId: "user.create", policy: this.policy.for("user.create"), actor,
        behavior: "created", module: "user", entityId: next.id, after: { id: next.id, email: next.email, roleId: next.roleId },
        ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("users");
    return mapUser(value);
  }
  async update(id: string, dto: UpdateUserDto, actor: Actor, requestId?: string): Promise<UserResponseDto> {
    const value = await this.audit.transact(async (tx) => {
      const prior = await tx.user.findFirst({ where: { id, deletedAt: null }, include });
      if (!prior) throw new NotFoundException("User not found");
      await assertRoleWithinActor(tx, actor.roleId, prior.roleId);
      if (dto.roleId !== undefined) await assertRoleWithinActor(tx, actor.roleId, dto.roleId);
      const next = await tx.user.update({ where: { id }, data: {
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
      }, include });
      return [next, { endpointId: "user.update", policy: this.policy.for("user.update"), actor,
        behavior: "updated", module: "user", entityId: id,
        before: { id, email: prior.email, roleId: prior.roleId }, after: { id, email: next.email, roleId: next.roleId },
        ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("users");
    return mapUser(value);
  }
  async delete(id: string, actor: Actor, requestId?: string): Promise<void> {
    if (id === actor.id) throw new ForbiddenException("You cannot delete your own account");
    await this.audit.transact(async (tx) => {
      const prior = await tx.user.findFirst({ where: { id, deletedAt: null }, include });
      if (!prior) throw new NotFoundException("User not found");
      await assertRoleWithinActor(tx, actor.roleId, prior.roleId);
      await tx.user.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return [undefined, { endpointId: "user.delete", policy: this.policy.for("user.delete"), actor,
        behavior: "deleted", module: "user", entityId: id,
        before: { id, email: prior.email, roleId: prior.roleId }, ...(requestId ? { requestId } : {}) }] as const;
    });
    await this.cache.invalidate("users");
  }
}
