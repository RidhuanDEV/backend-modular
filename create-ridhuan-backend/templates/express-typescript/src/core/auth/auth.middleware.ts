import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.service.js";
import { HttpError } from "../errors/http-error.js";
import { prisma } from "../../config/prisma.js";

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    next(HttpError.unauthorized("Missing or invalid authorization header"));
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, deletedAt: true },
    });
    const isUserActive = user !== null && user.deletedAt === null;

    if (!isUserActive) {
      next(HttpError.unauthorized("User account is inactive or deleted"));
      return;
    }

    req.user = payload;
    next();
  } catch {
    next(HttpError.unauthorized("Invalid or expired token"));
  }
}
