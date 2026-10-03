import { RoleRepository } from "./role.repository.js";
import { prisma } from "../../config/prisma.js";
import { HttpError } from "../../core/errors/http-error.js";
import { cacheService } from "../../core/cache/cache.service.js";
import { roleCacheSchema } from "../../core/cache/cache-schemas.js";
import { z } from "zod";
import { auditService } from "../../core/audit/audit.service.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { ROLE_MODULE } from "../../constants/modules.constants.js";
import {
  assertPermissionsWithinActor,
  assertRoleWithinActor,
} from "../../core/auth/privilege.js";
import type {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
} from "./role.schema.js";
import type { JwtUserPayload } from "../../types/index.js";

const repository = new RoleRepository();
const CACHE_PREFIX = ROLE_MODULE;

export class RoleService {
  async findAll() {
    const cacheKey = `${CACHE_PREFIX}:list`;
    const cached = await cacheService.get(cacheKey, z.array(roleCacheSchema));
    if (cached) return cached;

    const roles = await repository.findAll();
    await cacheService.set(cacheKey, roles, 300);
    return roles;
  }

  async findById(id: string) {
    const cacheKey = `${CACHE_PREFIX}:${id}`;
    const cached = await cacheService.get(cacheKey, roleCacheSchema);
    if (cached) return cached;

    const role = await repository.findById(id);
    if (!role) throw HttpError.notFound("Role not found");

    await cacheService.set(cacheKey, role, 300);
    return role;
  }

  async create(dto: CreateRoleDto, user: JwtUserPayload, requestId?: string) {
    const existing = await repository.findByName(dto.name);
    if (existing) throw HttpError.conflict(`Role '${dto.name}' already exists`);

    const role = await prisma.$transaction(async (tx) => {
      const created = await repository.create(dto, tx);
      await auditService.persist({
        action: AuditAction.CREATE,
        module: ROLE_MODULE,
        entityId: created.id,
        userId: user.id,
        after: created,
        requestId,
        trx: tx,
      });
      return created;
    });

    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    return role;
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    user: JwtUserPayload,
    requestId?: string,
  ) {
    if (dto.name) {
      const existing = await repository.findByName(dto.name);
      if (existing && existing.id !== id) {
        throw HttpError.conflict(`Role '${dto.name}' already exists`);
      }
    }

    const role = await prisma.$transaction(async (tx) => {
      const existingRole = await repository.findById(id, tx);
      if (!existingRole) throw HttpError.notFound("Role not found");
      await assertRoleWithinActor(tx, user.id, id);
      const updated = await repository.update(id, dto, tx);
      if (!updated) throw HttpError.notFound("Role not found");

      await auditService.persist({
        action: AuditAction.UPDATE,
        module: ROLE_MODULE,
        entityId: id,
        userId: user.id,
        before: existingRole,
        after: updated,
        requestId,
        trx: tx,
      });

      return updated;
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    return role;
  }

  async delete(id: string, user: JwtUserPayload, requestId?: string) {
    await prisma.$transaction(async (tx) => {
      const existingRole = await repository.findById(id, tx);
      if (!existingRole) throw HttpError.notFound("Role not found");
      await assertRoleWithinActor(tx, user.id, id);
      const deleted = await repository.delete(id, tx);
      if (!deleted) throw HttpError.notFound("Role not found");

      await auditService.persist({
        action: AuditAction.DELETE,
        module: ROLE_MODULE,
        entityId: id,
        userId: user.id,
        before: existingRole,
        requestId,
        trx: tx,
      });
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    // Invalidate all permission caches (users with this role need refresh)
    await cacheService.invalidatePattern("permissions:*");
  }

  async assignPermissions(
    id: string,
    dto: AssignPermissionsDto,
    user: JwtUserPayload,
    requestId?: string,
  ) {
    const updatedRole = await prisma.$transaction(async (tx) => {
      const existingRole = await repository.findById(id, tx);
      if (!existingRole) throw HttpError.notFound("Role not found");
      // Both the permissions being removed and the ones being granted must be within the actor's own.
      await assertRoleWithinActor(tx, user.id, id);
      await assertPermissionsWithinActor(tx, user.id, dto.permissionIds);
      await repository.setPermissions(id, dto.permissionIds, tx);
      const updated = await repository.findById(id, tx);
      if (!updated) throw HttpError.notFound("Role not found");

      await auditService.persist({
        action: AuditAction.ASSIGN_PERMISSIONS,
        module: ROLE_MODULE,
        entityId: id,
        userId: user.id,
        before: existingRole,
        after: updated,
        requestId,
        trx: tx,
      });

      return updated;
    });

    await cacheService.del(`${CACHE_PREFIX}:${id}`);
    await cacheService.invalidatePattern(`${CACHE_PREFIX}:*`);
    // Invalidate permission caches for all users with this role
    await cacheService.invalidatePattern("permissions:*");

    return updatedRole;
  }
}
