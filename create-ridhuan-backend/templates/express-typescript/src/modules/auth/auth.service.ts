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

    const user = await prisma.$transaction(async (tx) => {
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
    const isMatch = await bcrypt.compare(dto.password, user?.password ?? (await dummyPasswordHash()));
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

    await auditService.persist({
      action: AuditAction.LOGIN, module: AUTH_MODULE, userId: user.id,
      after: { email: user.email }, requestId,
    });

    await prisma.$transaction([
      // Keep the table bounded: drop this user's sessions that can no longer be used.
      prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: now } } }),
      prisma.refreshToken.create({
        data: {
          tokenHash: hashRefreshToken(refreshToken),
          familyId: randomUUID(),
          userId: user.id,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
      }),
    ]);

    return { token, refreshToken };
  }

  async refresh(rawRefreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const now = new Date();
    const oldTokenHash = hashRefreshToken(rawRefreshToken);
    const nextRefreshToken = createRefreshToken();
    const nextTokenHash = hashRefreshToken(nextRefreshToken);

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.refreshToken.findUnique({
        where: { tokenHash: oldTokenHash },
        include: { user: true },
      });
      if (!session) return { kind: "invalid" as const };

      if (session.revokedAt !== null) {
        await tx.refreshToken.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "invalid" as const };
      }

      if (session.expiresAt <= now || session.user.deletedAt !== null) {
        await tx.refreshToken.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "invalid" as const };
      }

      const revoked = await tx.refreshToken.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: "invalid" as const };
      }

      await tx.refreshToken.create({
        data: {
          tokenHash: nextTokenHash,
          familyId: session.familyId,
          userId: session.userId,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
      });

      return {
        kind: "success" as const,
        user: session.user,
      };
    });

    if (result.kind !== "success") {
      throw HttpError.unauthorized("Invalid or expired refresh token");
    }

    return {
      token: signToken({
        id: result.user.id,
        email: result.user.email,
        roleId: result.user.roleId,
      }),
      refreshToken: nextRefreshToken,
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: {
        tokenHash: hashRefreshToken(rawRefreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string) {
    const user = await repository.findById(userId);
    if (!user) throw HttpError.notFound("User not found");
    return toAuthUserResponse(user);
  }
}
