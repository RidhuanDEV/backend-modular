import type { JwtUserPayload } from "../../../types/index.js";
import type { User } from "@prisma/client";
import { HttpError } from "../../../core/errors/http-error.js";
import { assertRoleWithinActor } from "../../../core/auth/privilege.js";
import type { Prisma } from "@prisma/client";

/**
 * Resource-level authorization policy for User.
 *
 * Route-level RBAC (manage_users, etc.) is handled by
 * requirePermission() middleware. Use this class for ownership checks
 * or additional business rules that need the loaded resource.
 *
 * Throw HttpError.forbidden() to deny access, return void to allow.
 */
export class UserPolicy {
  canView(_user: JwtUserPayload, _resource?: User): void {
    // Add resource-level checks here if needed.
  }

  /** The assigned role may not carry permissions the actor lacks. */
  async canCreate(user: JwtUserPayload, roleId: string, trx: Prisma.TransactionClient): Promise<void> {
    await assertRoleWithinActor(trx, user.id, roleId);
  }

  /** The actor must outrank the target both before and after a role change. */
  async canUpdate(
    user: JwtUserPayload,
    resource: User,
    nextRoleId: string | undefined,
    trx: Prisma.TransactionClient,
  ): Promise<void> {
    await assertRoleWithinActor(trx, user.id, resource.roleId);
    if (nextRoleId !== undefined && nextRoleId !== resource.roleId) {
      await assertRoleWithinActor(trx, user.id, nextRoleId);
    }
  }

  async canDelete(user: JwtUserPayload, resource: User, trx: Prisma.TransactionClient): Promise<void> {
    if (user.id === resource.id) {
      throw HttpError.forbidden("You cannot delete your own account.");
    }
    await assertRoleWithinActor(trx, user.id, resource.roleId);
  }
}

export const userPolicy = new UserPolicy();
