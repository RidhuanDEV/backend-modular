import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { endpointRegistry } from "../endpoint/endpoint.registry";

type Reader = Pick<Prisma.TransactionClient, "role" | "rolePermission">;

/** The seeded administrator role; access itself is decided by RBAC permissions. */
export const ROOT_ROLE = "admin";
export const DEFAULT_ROLE = "user";

/** Seeded roles the code depends on by name: registration needs `user`, uploads trust `admin`. */
export const SYSTEM_ROLES: ReadonlySet<string> = new Set([
  ROOT_ROLE,
  DEFAULT_ROLE,
]);

/**
 * Every permission an endpoint checks by name. Renaming or deleting one would
 * let a permission manager mint access it was never granted.
 */
export const SYSTEM_PERMISSIONS: ReadonlySet<string> = new Set(
  Object.values(endpointRegistry).flatMap((definition) =>
    definition.permission ? [definition.permission] : [],
  ),
);

export function assertNotSystemName(
  names: ReadonlySet<string>,
  kind: "role" | "permission",
  name: string | undefined,
): void {
  if (name !== undefined && names.has(name)) {
    throw new ForbiddenException(
      `System ${kind} '${name}' cannot be created, renamed or deleted`,
    );
  }
}

/**
 * Anti-escalation rule: an actor may only grant, assign or manage permissions
 * it already holds. Route permissions (manage_users, manage_roles) decide who
 * may call the endpoint; this decides what they may hand out through it.
 */
export async function assertPermissionsWithinActor(
  tx: Reader,
  actorRoleId: string,
  permissionIds: readonly string[],
): Promise<void> {
  if (permissionIds.length === 0) return;
  const actorRole = await tx.role.findUnique({
    where: { id: actorRoleId },
    select: { permissions: { select: { permissionId: true } } },
  });
  const heldIds = new Set(
    actorRole?.permissions.map((row) => row.permissionId) ?? [],
  );
  if (permissionIds.some((id) => !heldIds.has(id))) {
    throw new ForbiddenException(
      "You cannot grant or manage permissions you do not hold",
    );
  }
}

export async function assertRoleWithinActor(
  tx: Reader,
  actorRoleId: string,
  roleId: string,
): Promise<void> {
  if (roleId === actorRoleId) return;
  const rows = await tx.rolePermission.findMany({
    where: { roleId },
    select: { permissionId: true },
  });
  await assertPermissionsWithinActor(
    tx,
    actorRoleId,
    rows.map((row) => row.permissionId),
  );
}

export async function isRootRole(
  tx: Pick<Prisma.TransactionClient, "role">,
  roleId: string,
): Promise<boolean> {
  const role = await tx.role.findUnique({
    where: { id: roleId },
    select: { name: true },
  });
  return role?.name === ROOT_ROLE;
}

/**
 * Lockout guard: every system permission must stay held by at least one active
 * user, or nobody could grant it again. Locks the system permission rows (a
 * locking read under PostgreSQL and MySQL) so concurrent RBAC mutations
 * serialize, then returns a check to run after the mutation in the same
 * transaction. Only permissions that become unheld fail.
 */
export async function guardSystemPermissionHolders(
  tx: Prisma.TransactionClient,
): Promise<() => Promise<void>> {
  const names = [...SYSTEM_PERMISSIONS];
  // Names come from the endpoint registry, never from input.
  await tx.$queryRawUnsafe(
    `SELECT id FROM permissions WHERE name IN (${names.map((name) => `'${name}'`).join(",")}) FOR UPDATE`,
  );
  const unheld = async () =>
    (
      await tx.permission.findMany({
        where: {
          name: { in: names },
          roles: { none: { role: { users: { some: { deletedAt: null } } } } },
        },
        select: { name: true },
      })
    ).map((row) => row.name);
  const before = new Set(await unheld());
  return async () => {
    const lost = (await unheld()).filter((name) => !before.has(name));
    if (lost.length > 0) {
      throw new ForbiddenException(
        `Change would leave no active user holding '${lost[0]}'`,
      );
    }
  };
}

/**
 * Permissions are granted through RBAC only: a new permission goes to every
 * role that manages permissions, so its creator and other permission managers
 * can hand it out without a role-name exemption.
 */
export async function grantToPermissionManagers(
  tx: Pick<Prisma.TransactionClient, "role" | "rolePermission">,
  permissionId: string,
): Promise<void> {
  const managers = await tx.role.findMany({
    where: {
      permissions: { some: { permission: { name: "manage_permissions" } } },
    },
    select: { id: true },
  });
  if (managers.length === 0) return;
  await tx.rolePermission.createMany({
    data: managers.map((role) => ({ roleId: role.id, permissionId })),
    skipDuplicates: true,
  });
}

/** Access changed: every refresh session must re-authenticate under the new rules. */
export async function revokeUserSessions(
  tx: Pick<Prisma.TransactionClient, "refreshFamily" | "refreshToken">,
  userId: string,
): Promise<void> {
  const now = new Date();
  await tx.refreshFamily.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}
