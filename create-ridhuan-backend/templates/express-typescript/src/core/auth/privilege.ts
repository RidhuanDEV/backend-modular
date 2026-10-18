import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../errors/http-error.js";
import { PERMISSION_GROUPS } from "../../constants/permissions.constants.js";

type Client = Prisma.TransactionClient;

/** The seeded administrator role; access itself is decided by RBAC permissions. */
export const ROOT_ROLE = "admin";
export const DEFAULT_ROLE = "user";

/** Seeded roles the code depends on by name: registration needs `user`, uploads trust `admin`. */
export const SYSTEM_ROLES: ReadonlySet<string> = new Set([
  ROOT_ROLE,
  DEFAULT_ROLE,
]);

/**
 * RBAC checks permissions by name, so renaming or deleting one of these would
 * let a permission manager mint access it was never granted.
 */
const MANAGE_PERMISSIONS = PERMISSION_GROUPS.PERMISSION.MANAGE;

export const SYSTEM_PERMISSIONS: ReadonlySet<string> = new Set(
  Object.values(PERMISSION_GROUPS).flatMap((group) => Object.values(group)),
);

export function assertNotSystemName(
  names: ReadonlySet<string>,
  kind: "role" | "permission",
  name: string | undefined,
): void {
  if (name !== undefined && names.has(name)) {
    throw HttpError.forbidden(
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
  client: Client,
  actorId: string,
  permissionIds: readonly string[],
): Promise<void> {
  if (permissionIds.length === 0) return;
  const actor = await client.user.findFirst({
    where: { id: actorId, deletedAt: null },
    select: {
      role: {
        select: { permissions: { select: { permissionId: true } } },
      },
    },
  });
  const held = new Set(
    actor?.role.permissions.map((row) => row.permissionId) ?? [],
  );
  if (permissionIds.some((id) => !held.has(id))) {
    throw HttpError.forbidden(
      "You cannot grant or manage permissions you do not hold",
    );
  }
}

export async function assertRoleWithinActor(
  client: Client,
  actorId: string,
  roleId: string,
): Promise<void> {
  const rows = await client.rolePermission.findMany({
    where: { roleId },
    select: { permissionId: true },
  });
  await assertPermissionsWithinActor(
    client,
    actorId,
    rows.map((row) => row.permissionId),
  );
}

/**
 * Lockout guard: every system permission must stay held by at least one active
 * user, or nobody could grant it again. Locks the system permission rows so
 * concurrent RBAC mutations serialize, then returns a check to run after the
 * mutation inside the same transaction. Only newly unheld permissions fail.
 */
export async function guardSystemPermissionHolders(
  client: Client,
): Promise<() => Promise<void>> {
  const names = [...SYSTEM_PERMISSIONS];
  await (env.DB_PROVIDER === "mysql"
    ? client.$queryRaw`
      SELECT id FROM \`Permission\` WHERE name IN (${Prisma.join(names)})
      FOR UPDATE`
    : client.$queryRaw`
      SELECT "id" FROM "Permission" WHERE "name" IN (${Prisma.join(names)})
      FOR UPDATE`);
  const unheld = async () =>
    (
      await client.permission.findMany({
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
      throw HttpError.forbidden(
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
  client: Client,
  permissionId: string,
): Promise<void> {
  const managers = await client.role.findMany({
    where: {
      permissions: { some: { permission: { name: MANAGE_PERMISSIONS } } },
    },
    select: { id: true },
  });
  if (managers.length === 0) return;
  await client.rolePermission.createMany({
    data: managers.map((role) => ({ roleId: role.id, permissionId })),
    skipDuplicates: true,
  });
}

/** Access changed: every refresh session must re-authenticate under the new rules. */
export async function revokeUserSessions(
  client: Client,
  userId: string,
): Promise<void> {
  const now = new Date();
  await client.refreshFamily.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Root users may read any record; everyone else only their own. */
export async function isRootUser(
  client: Client,
  userId: string,
): Promise<boolean> {
  const user = await client.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { role: { select: { name: true } } },
  });
  return user?.role.name === ROOT_ROLE;
}
