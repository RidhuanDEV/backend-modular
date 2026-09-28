import { PermissionRepository } from "./permission.repository.js";
import { prisma } from "../../config/prisma.js";
import { HttpError } from "../../core/errors/http-error.js";
import { cacheService } from "../../core/cache/cache.service.js";
import { permissionCacheSchema } from "../../core/cache/cache-schemas.js";
import { z } from "zod";
import { auditService } from "../../core/audit/audit.service.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { PERMISSION_MODULE } from "../../constants/modules.constants.js";
import type {
  CreatePermissionDto,
  UpdatePermissionDto,
} from "./permission.schema.js";
import type { JwtUserPayload } from "../../types/index.js";

const repository = new PermissionRepository();
const CACHE_PREFIX = PERMISSION_MODULE;

export class PermissionService {
  async findAll() {
    const cacheKey = `${CACHE_PREFIX}:list`;
    const cached = await cacheService.get(cacheKey, z.array(permissionCacheSchema));
    if (cached) return cached;

    const permissions = await repository.findAll();
    await cacheService.set(cacheKey, permissions, 300);
    return permissions;
  }

  async findById(id: string) {
    const cacheKey = `${CACHE_PREFIX}:${id}`;
    const cached = await cacheService.get(cacheKey, permissionCacheSchema);
    if (cached) return cached;

    const permission = await repository.findById(id);
    if (!permission) throw HttpError.notFound("Permission not found");

    await cacheService.set(cacheKey, permission, 300);
    return permission;
  }

  async create(
    dto: CreatePermissionDto,
    user: JwtUserPayload,
    requestId?: string,
  ) {
    const existing = await repository.findByName(dto.name);
    if (existing)
      throw HttpError.conflict(`Permission '${dto.name}' already exists`);

    const permission = await prisma.$transaction(async (tx) => {
      const created = await repository.create(dto, tx);

      await auditService.persist({
        action: AuditAction.CREATE,
        module: PERMISSION_MODULE,
        entityId: created.id,
        userId: user.id,
        after: created,
        requestId,
        trx: tx,
      });

      return created;
    });

    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    return permission;
  }

  async update(
    id: string,
    dto: UpdatePermissionDto,
    user: JwtUserPayload,
    requestId?: string,
  ) {
    if (dto.name) {
      const existing = await repository.findByName(dto.name);
      if (existing && existing.id !== id) {
        throw HttpError.conflict(`Permission '${dto.name}' already exists`);
      }
    }

    const permission = await prisma.$transaction(async (tx) => {
      const existingPermission = await repository.findById(id, tx);
      if (!existingPermission) throw HttpError.notFound("Permission not found");
      const updated = await repository.update(id, dto, tx);
      if (!updated) throw HttpError.notFound("Permission not found");

      await auditService.persist({
        action: AuditAction.UPDATE,
        module: PERMISSION_MODULE,
        entityId: id,
        userId: user.id,
        before: existingPermission,
        after: updated,
        requestId,
        trx: tx,
      });

      return updated;
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    // Renaming a permission invalidates all user permission caches
    await cacheService.invalidatePattern("permissions:*");
    return permission;
  }

  async delete(id: string, user: JwtUserPayload, requestId?: string) {
    await prisma.$transaction(async (tx) => {
      const existingPermission = await repository.findById(id, tx);
      if (!existingPermission) throw HttpError.notFound("Permission not found");
      const deleted = await repository.delete(id, tx);
      if (!deleted) throw HttpError.notFound("Permission not found");

      await auditService.persist({
        action: AuditAction.DELETE,
        module: PERMISSION_MODULE,
        entityId: id,
        userId: user.id,
        before: existingPermission,
        requestId,
        trx: tx,
      });
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    await cacheService.invalidatePattern("permissions:*");
  }
}
