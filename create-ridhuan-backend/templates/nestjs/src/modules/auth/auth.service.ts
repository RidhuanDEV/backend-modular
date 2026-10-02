import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import type { Prisma } from "../../generated/prisma/client";
import type { AppConfig } from "../../config/env.validation";
import { PrismaService } from "../../platform/database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import type {
  AuthResponseDto,
  AuthUserResponseDto,
  LoginDto,
  RegisterDto,
} from "./dto/auth.dto";

import { lockRefreshFamily } from "../../common/auth/refresh-family";

const REFRESH_DAYS = 30;
function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
// Unknown emails still pay one bcrypt comparison so response time does not reveal which accounts exist.
let timingHash: Promise<string> | undefined;
function dummyPasswordHash(): Promise<string> {
  timingHash ??= bcrypt.hash(randomBytes(16).toString("hex"), 12);
  return timingHash;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private toUser(user: {
    id: string;
    email: string;
    roleId: string;
    createdAt: Date;
    updatedAt: Date;
  }): AuthUserResponseDto {
    return {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async issue(
    user: { id: string },
    familyId = randomUUID(),
    expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400000),
    writer: Pick<
      Prisma.TransactionClient,
      "refreshToken" | "refreshFamily"
    > = this.prisma,
  ): Promise<AuthResponseDto> {
    const token = await this.jwt.signAsync(
      { sub: user.id, tokenUse: "access" },
      {
        secret: this.config.get("JWT_SECRET", { infer: true }),
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: this.config.get("JWT_ISSUER", { infer: true }),
        audience: this.config.get("JWT_AUDIENCE", { infer: true }),
      },
    );
    const refreshToken = randomBytes(48).toString("base64url");
    await writer.refreshFamily.create({
      data: { id: familyId, userId: user.id, expiresAt },
    });
    await writer.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        familyId,
        userId: user.id,
        expiresAt,
      },
    });
    return { token, refreshToken };
  }

  async register(
    input: RegisterDto,
    requestId?: string,
  ): Promise<AuthUserResponseDto> {
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) throw new ConflictException("Email already registered");
    const role = await this.prisma.role.findUnique({ where: { name: "user" } });
    if (!role) throw new Error("Default user role has not been seeded");
    const password = await bcrypt.hash(input.password, 12);
    const user = await this.audit.transact(async (tx) => {
      const created = await tx.user.create({
        data: { email, password, roleId: role.id },
        include: { role: true },
      });
      return [
        created,
        {
          endpointId: "auth.register",
          policy: this.policy.for("auth.register"),
          behavior: "created",
          module: "auth",
          entityId: created.id,
          after: {
            id: created.id,
            email: created.email,
            role: created.role.name,
          },
          ...(requestId ? { requestId } : {}),
        },
      ] as const;
    });
    return this.toUser(user);
  }

  async login(input: LoginDto, requestId?: string): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      include: { role: true },
    });
    const matches = await bcrypt.compare(
      input.password,
      user?.password ?? (await dummyPasswordHash()),
    );
    if (!user || user.deletedAt || !matches)
      throw new UnauthorizedException("Invalid credentials");
    const policy = this.policy.for("auth.login");
    const change = {
      endpointId: "auth.login" as const,
      policy,
      behavior: "login",
      module: "auth",
      entityId: user.id,
      actor: { id: user.id, email: user.email, roleId: user.roleId },
      ...(requestId ? { requestId } : {}),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      // Active families retain their consumed hashes for replay detection.
      const tokens = await this.issue(
        user,
        randomUUID(),
        new Date(Date.now() + REFRESH_DAYS * 86400000),
        tx,
      );
      if (policy.audit === "required") await this.audit.write(change, tx);
      return tokens;
    });
    if (policy.audit === "optional") await this.audit.write(change);
    return result;
  }

  async refresh(value: string, requestId?: string): Promise<AuthResponseDto> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(value) },
    });
    if (!existing) throw new UnauthorizedException("Invalid refresh token");
    const raw = randomBytes(48).toString("base64url");
    const actor = await this.prisma.user.findUnique({
      where: { id: existing.userId },
      select: { id: true, email: true, roleId: true },
    });
    const change = {
      endpointId: "auth.refresh" as const,
      policy: this.policy.for("auth.refresh"),
      behavior: "refresh",
      module: "auth",
      entityId: existing.familyId,
      ...(actor ? { actor } : {}),
      ...(requestId ? { requestId } : {}),
    };
    let mutated = false;
    let state:
      | {
          before: { expiresAt: string; revoked: boolean };
          after: { expiresAt: string; revoked: boolean };
        }
      | undefined;
    const user = await this.prisma.$transaction(async (tx) => {
      const family = await lockRefreshFamily(tx, existing.familyId);
      const stored = await tx.refreshToken.findUnique({
        where: { id: existing.id },
        include: { user: true },
      });
      if (!family || !stored) return undefined;
      const now = new Date();
      const before = {
        expiresAt: family.expiresAt.toISOString(),
        revoked: Boolean(family.revokedAt),
      };
      if (
        family.revokedAt ||
        family.expiresAt <= now ||
        stored.revokedAt ||
        stored.expiresAt <= now ||
        stored.user.deletedAt
      ) {
        await tx.refreshFamily.update({
          where: { id: family.id },
          data: { revokedAt: family.revokedAt ?? now },
        });
        await tx.refreshToken.updateMany({
          where: { familyId: family.id, revokedAt: null },
          data: { revokedAt: now },
        });
        mutated = true;
        state = {
          before,
          after: { expiresAt: before.expiresAt, revoked: true },
        };
        if (change.policy.audit === "required")
          await this.audit.write(
            { ...change, ...state, behavior: "refresh_replay" },
            tx,
          );
        return undefined;
      }
      const expiresAt = new Date(now.getTime() + REFRESH_DAYS * 86400000);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now },
      });
      await tx.refreshFamily.update({
        where: { id: family.id },
        data: { expiresAt },
      });
      await tx.refreshToken.create({
        data: {
          tokenHash: hashToken(raw),
          familyId: family.id,
          userId: family.userId,
          expiresAt,
        },
      });
      mutated = true;
      state = {
        before,
        after: { expiresAt: expiresAt.toISOString(), revoked: false },
      };
      if (change.policy.audit === "required")
        await this.audit.write({ ...change, ...state }, tx);
      return stored.user;
    });
    if (mutated && change.policy.audit === "optional")
      await this.audit.write({
        ...change,
        ...state,
        ...(!user ? { behavior: "refresh_replay" } : {}),
      });
    if (!user)
      throw new UnauthorizedException("Invalid or expired refresh token");
    const token = await this.jwt.signAsync(
      { sub: user.id, tokenUse: "access" },
      {
        secret: this.config.get("JWT_SECRET", { infer: true }),
        algorithm: "HS256",
        expiresIn: "15m",
        issuer: this.config.get("JWT_ISSUER", { infer: true }),
        audience: this.config.get("JWT_AUDIENCE", { infer: true }),
      },
    );
    return { token, refreshToken: raw };
  }

  async me(actor: Actor): Promise<AuthUserResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      include: { role: true },
    });
    return this.toUser(user);
  }

  async logout(value: string, requestId?: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(value) },
    });
    if (!existing) return;
    const actor = await this.prisma.user.findUnique({
      where: { id: existing.userId },
      select: { id: true, email: true, roleId: true },
    });
    const change = {
      endpointId: "auth.logout" as const,
      policy: this.policy.for("auth.logout"),
      behavior: "logout",
      module: "auth",
      entityId: existing.familyId,
      ...(actor ? { actor } : {}),
      ...(requestId ? { requestId } : {}),
    };
    let state:
      | {
          before: { expiresAt: string; revoked: boolean };
          after: { expiresAt: string; revoked: boolean };
        }
      | undefined;
    const changed = await this.prisma.$transaction(async (tx) => {
      const family = await lockRefreshFamily(tx, existing.familyId);
      if (!family || family.revokedAt) return false;
      const revokedAt = new Date();
      state = {
        before: { expiresAt: family.expiresAt.toISOString(), revoked: false },
        after: { expiresAt: family.expiresAt.toISOString(), revoked: true },
      };
      await tx.refreshFamily.update({
        where: { id: family.id },
        data: { revokedAt },
      });
      await tx.refreshToken.updateMany({
        where: { familyId: family.id, revokedAt: null },
        data: { revokedAt },
      });
      if (change.policy.audit === "required")
        await this.audit.write({ ...change, ...state }, tx);
      return true;
    });
    if (changed && change.policy.audit === "optional")
      await this.audit.write({ ...change, ...state });
  }
}
