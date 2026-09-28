import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../../config/prisma.js";
import type { PermissionName } from "../../constants/permissions.constants.js";

async function resolvePermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: {
        select: {
          permissions: {
            select: {
              permission: {
                select: { name: true },
              },
            },
          },
        },
      },
    },
  });

  const permissions =
    user?.role?.permissions?.map((rp) => rp.permission.name) ?? [];
  return permissions;
}

export function requirePermission(permissionName: PermissionName) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = req.user;

    if (!user) {
      next(HttpError.unauthorized("Authentication required"));
      return;
    }

    try {
      const permissions = await resolvePermissions(user.id);

      if (!permissions.includes(permissionName)) {
        next(HttpError.forbidden(`Missing permission: ${permissionName}`));
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
