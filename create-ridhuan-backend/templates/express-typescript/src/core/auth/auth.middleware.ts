import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.service.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../../config/prisma.js";

/**
 * Signature and claims only, no database access. Runs before the per-user rate
 * limiter so throttling happens before any query is made for the request.
 */
export function verifyAccessToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(HttpError.unauthorized("Missing or invalid authorization header"));
    return;
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    next(HttpError.unauthorized("Invalid or expired token"));
  }
}

/**
 * The token proves identity only. Activity and role come from the database so a
 * deleted user or a role change takes effect immediately, not when the token expires.
 */
export async function requireActiveUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    next(HttpError.unauthorized("Authentication required"));
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { email: true, roleId: true, deletedAt: true },
    });
    if (user === null || user.deletedAt !== null) {
      next(HttpError.unauthorized("User account is inactive or deleted"));
      return;
    }
    req.user = { ...req.user, email: user.email, roleId: user.roleId };
    next();
  } catch (err) {
    next(err);
  }
}
