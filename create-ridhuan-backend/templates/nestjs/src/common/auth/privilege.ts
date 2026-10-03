import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

type Reader = Pick<Prisma.TransactionClient, "role" | "rolePermission">;

/**
 * The seeded root role. It is exempt because it must be able to hand out
 * permissions created after seeding, which it does not hold itself.
 */
export const ROOT_ROLE = "admin";

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
    select: { name: true, permissions: { select: { permissionId: true } } },
  });
  if (actorRole?.name === ROOT_ROLE) return;
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
