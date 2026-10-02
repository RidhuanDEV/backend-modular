import bcrypt from "bcrypt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuthRepository } from "./auth.repository.js";
import { signToken } from "../../core/auth/jwt.service.js";
import { HttpError } from "../../core/errors/http-error.js";
import { auditService } from "../../core/audit/audit.service.js";
import { prisma } from "../../config/prisma.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { AUTH_MODULE, USER_MODULE } from "../../constants/modules.constants.js";
import type { RegisterDto, LoginDto } from "./auth.schema.js";
import type { User } from "@prisma/client";
import type { AuthUserResponseDto } from "./dto/auth-user-response.dto.js";

import { lockRefreshFamily } from "../../core/auth/refresh-family.js";

const SALT_ROUNDS = 12;
const DEFAULT_ROLE = "user";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const repository = new AuthRepository();

function toAuthUserResponse(user: User): AuthUserResponseDto {
  return {
    id: user.id,
    email: user.email,
    roleId: user.roleId,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

// Unknown emails still pay one bcrypt comparison so response time does not reveal which accounts exist.
let timingHash: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> {
  timingHash ??= bcrypt.hash(randomBytes(16).toString("hex"), SALT_ROUNDS);
  return timingHash;
}

export class AuthService {
  async register(dto: RegisterDto, requestId?: string) {
    const exists = await repository.emailExists(dto.email);
    if (exists) {
      throw HttpError.conflict("Email already registered");
    }

    const defaultRole = await repository.findRoleByName(DEFAULT_ROLE);
    if (!defaultRole) {
      throw HttpError.internal(
        "Default role not found. Please seed the database.",
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await auditService.transaction(async (tx) => {
      const created = await repository.createUser(
        {
          email: dto.email,
          password: hashedPassword,
          roleId: defaultRole.id,
        },
        tx,
      );

      await auditService.persist({
        action: AuditAction.REGISTER,
        module: USER_MODULE,
        entityId: created.id,
        userId: created.id,
        after: created,
        requestId,
        trx: tx,
      });

      return created;
    });

    return toAuthUserResponse(user);
  }

  async login(dto: LoginDto, requestId?: string) {
    const user = await repository.findByEmail(dto.email);
    const isMatch = await bcrypt.compare(
      dto.password,
      user?.password ?? (await dummyPasswordHash()),
    );
    if (!user || user.deletedAt !== null || !isMatch) {
      throw HttpError.unauthorized("Invalid email or password");
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      roleId: user.roleId,
    });
    const refreshToken = createRefreshToken();
    const now = new Date();

    await auditService.transaction(async (tx) => {
      const familyId = randomUUID();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
      await tx.refreshFamily.create({
        data: { id: familyId, userId: user.id, expiresAt },
      });
      await tx.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(refreshToken),
          familyId,
          userId: user.id,
          expiresAt,
        },
      });
      await auditService.persist({
        action: AuditAction.LOGIN,
        module: AUTH_MODULE,
        userId: user.id,
        after: { email: user.email },
        requestId,
        trx: tx,
      });
    });

    return { token, refreshToken };
  }

  async refresh(
    rawRefreshToken: string,
    requestId?: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    });
    if (!stored)
      throw HttpError.unauthorized("Invalid or expired refresh token");
    const nextRefreshToken = createRefreshToken();
    const result = await auditService.transaction(async (tx) => {
      const family = await lockRefreshFamily(tx, stored.familyId);
      const now = new Date();
      const session = await tx.refreshToken.findUnique({
        where: { id: stored.id },
        include: { user: true },
      });
      if (!family || !session) return undefined;
      const before = {
        expiresAt: family.expiresAt.toISOString(),
        revoked: Boolean(family.revokedAt),
      };
      if (
        family.revokedAt ||
        family.expiresAt <= now ||
        session.revokedAt ||
        session.expiresAt <= now ||
        session.user.deletedAt
      ) {
        await tx.refreshFamily.update({
          where: { id: family.id },
          data: { revokedAt: family.revokedAt ?? now },
        });
        await tx.refreshToken.updateMany({
          where: { familyId: family.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await auditService.persist({
          action: AuditAction.REPLAY,
          module: AUTH_MODULE,
          entityId: family.id,
          userId: family.userId,
          before,
          after: { expiresAt: before.expiresAt, revoked: true },
          requestId,
          trx: tx,
        });
        return undefined;
      }
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
      await tx.refreshToken.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      await tx.refreshFamily.update({
        where: { id: family.id },
        data: { expiresAt },
      });
      await tx.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(nextRefreshToken),
          familyId: family.id,
          userId: family.userId,
          expiresAt,
        },
      });
      await auditService.persist({
        action: AuditAction.REFRESH,
        module: AUTH_MODULE,
        entityId: family.id,
        userId: family.userId,
        before,
        after: { expiresAt: expiresAt.toISOString(), revoked: false },
        requestId,
        trx: tx,
      });
      return session.user;
    });
    if (!result)
      throw HttpError.unauthorized("Invalid or expired refresh token");
    return {
      token: signToken({
        id: result.id,
        email: result.email,
        roleId: result.roleId,
      }),
      refreshToken: nextRefreshToken,
    };
  }

  async logout(rawRefreshToken: string, requestId?: string): Promise<void> {
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawRefreshToken) },
    });
    if (!stored) {
      auditService.noLogoutMutation();
      return;
    }
    await auditService.transaction(async (tx) => {
      const family = await lockRefreshFamily(tx, stored.familyId);
      if (!family || family.revokedAt) {
        auditService.noLogoutMutation();
        return;
      }
      const before = {
        expiresAt: family.expiresAt.toISOString(),
        revoked: false,
      };
      const revokedAt = new Date();
      await tx.refreshFamily.update({
        where: { id: family.id },
        data: { revokedAt },
      });
      await tx.refreshToken.updateMany({
        where: { familyId: family.id, revokedAt: null },
        data: { revokedAt },
      });
      await auditService.persist({
        action: AuditAction.LOGOUT,
        module: AUTH_MODULE,
        entityId: family.id,
        userId: family.userId,
        before,
        after: { expiresAt: before.expiresAt, revoked: true },
        requestId,
        trx: tx,
      });
    });
  }

  async me(userId: string) {
    const user = await repository.findById(userId);
    if (!user) throw HttpError.notFound("User not found");
    return toAuthUserResponse(user);
  }
}
