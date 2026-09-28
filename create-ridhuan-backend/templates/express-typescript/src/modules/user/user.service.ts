import { UserRepository } from "./user.repository.js";
import { prisma } from "../../config/prisma.js";
import { cacheService } from "../../core/cache/cache.service.js";
import { userCacheSchema, userListCacheSchema } from "../../core/cache/cache-schemas.js";
import { auditService } from "../../core/audit/audit.service.js";
import { HttpError } from "../../core/errors/http-error.js";
import { buildFindOptions } from "../../core/database/query-builder.js";
import { buildPaginationMeta } from "../../utils/pagination.js";
import { toUserResponse, toUserResponseList } from "./mappers/user.mapper.js";
import { userPolicy } from "./policies/user.policy.js";
import { userQueryConfig } from "./queries/user.query.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { USER_MODULE } from "../../constants/modules.constants.js";
import bcrypt from "bcrypt";
import type { CreateUserDto } from "./dto/create-user.dto.js";
import type { UpdateUserDto } from "./dto/update-user.dto.js";
import type { SearchUserDto } from "./dto/search-user.dto.js";
import type {
  JwtUserPayload,
  PaginationMeta,
} from "../../types/index.js";
import type {
  UserResponseDto,
  UserResponseProjection,
} from "./dto/user-response.dto.js";

const repository = new UserRepository();
const CACHE_PREFIX = USER_MODULE;

export class UserService {
  async findAll(
    query: SearchUserDto,
  ): Promise<{ data: UserResponseProjection[]; meta: PaginationMeta }> {
    const cacheKey = `${CACHE_PREFIX}:list:${JSON.stringify(query)}`;
    const cached = await cacheService.get(cacheKey, userListCacheSchema);
    if (cached) return cached;

    const findOptions = buildFindOptions(query, userQueryConfig);
    const { rows, count } = await repository.findAll(findOptions);
    const { page, limit } = query;

    const result = {
      data: toUserResponseList(rows),
      meta: buildPaginationMeta(page, limit, count),
    };

    await cacheService.set(cacheKey, result, 60);
    return result;
  }

  async findById(id: string): Promise<UserResponseDto> {
    const cacheKey = `${CACHE_PREFIX}:${id}`;
    const cached = await cacheService.get(cacheKey, userCacheSchema);
    if (cached) return cached;

    const record = await repository.findById(id);
    if (!record) throw HttpError.notFound("User not found");

    const response = toUserResponse(record);
    await cacheService.set(cacheKey, response, 120);
    return response;
  }

  async create(
    data: CreateUserDto,
    user: JwtUserPayload,
    requestId?: string,
  ): Promise<UserResponseDto> {
    userPolicy.canCreate(user);

    const created = await prisma.$transaction(async (tx) => {
      const record = await repository.create({ ...data, password: await bcrypt.hash(data.password, 12) }, tx);
      await auditService.persist({
        action: AuditAction.CREATE,
        module: USER_MODULE,
        entityId: record.id,
        userId: user.id,
        after: record,
        requestId,
        trx: tx,
      });
      return record;
    });

    await cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`);

    const full = await repository.findById(created.id);
    if (!full) throw HttpError.internal("Failed to load created user");
    return toUserResponse(full);
  }

  async update(
    id: string,
    data: UpdateUserDto,
    user: JwtUserPayload,
    requestId?: string,
  ): Promise<UserResponseDto> {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await repository.findById(id, tx);
      if (!existing) throw HttpError.notFound("User not found");
      userPolicy.canUpdate(user, existing);
      const record = await repository.update(id, data, tx);
      if (!record) throw HttpError.notFound("User not found");
      await auditService.persist({
        action: AuditAction.UPDATE,
        module: USER_MODULE,
        entityId: id,
        userId: user.id,
        before: existing,
        after: record,
        requestId,
        trx: tx,
      });
      return record;
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`);

    const full = await repository.findById(updated.id);
    if (!full) throw HttpError.internal("Failed to load updated user");
    return toUserResponse(full);
  }

  async delete(id: string, user: JwtUserPayload, requestId?: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await repository.findById(id, tx);
      if (!existing) throw HttpError.notFound("User not found");
      await userPolicy.canDelete(user, existing, tx);
      await repository.delete(id, tx);
      await auditService.persist({
        action: AuditAction.DELETE,
        module: USER_MODULE,
        entityId: id,
        userId: user.id,
        before: existing,
        requestId,
        trx: tx,
      });
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`);
  }
}
