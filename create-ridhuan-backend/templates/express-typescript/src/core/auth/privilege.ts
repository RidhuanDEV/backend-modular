import type { Prisma } from "@prisma/client";
import { HttpError } from "../errors/http-error.js";

type Client = Prisma.TransactionClient;

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
  client: Client,
  actorId: string,
  permissionIds: readonly string[],
): Promise<void> {
  if (permissionIds.length === 0) return;
  const actor = await client.user.findFirst({
    where: { id: actorId, deletedAt: null },
    select: { role: { select: { name: true, permissions: { select: { permissionId: true } } } } },
  });
  if (actor?.role.name === ROOT_ROLE) return;
  const held = new Set(actor?.role.permissions.map((row) => row.permissionId) ?? []);
  if (permissionIds.some((id) => !held.has(id))) {
    throw HttpError.forbidden("You cannot grant or manage permissions you do not hold");
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
  await assertPermissionsWithinActor(client, actorId, rows.map((row) => row.permissionId));
}
