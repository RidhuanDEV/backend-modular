import { randomBytes, randomUUID, createHash } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import type { Prisma } from "../../generated/prisma/client";
import type { AppConfig } from "../../config/env.validation";
import { PrismaService } from "../../platform/database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import type { AuthResponseDto, AuthUserResponseDto, LoginDto, RegisterDto } from "./dto/auth.dto";

const REFRESH_DAYS = 30;
class RefreshReplayError extends Error {}
function hashToken(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService, private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>) {}

  private toUser(user: { id: string; email: string; roleId: string; createdAt: Date; updatedAt: Date }): AuthUserResponseDto {
    return { id: user.id, email: user.email, roleId: user.roleId,
      createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() };
  }

  private async issue(user: { id: string }, familyId = randomUUID(),
    expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400000), writer: Pick<Prisma.TransactionClient, "refreshToken"> = this.prisma): Promise<AuthResponseDto> {
    const token = await this.jwt.signAsync({ sub: user.id, tokenUse: "access" }, {
      secret: this.config.get("JWT_SECRET", { infer: true }), algorithm: "HS256", expiresIn: "15m",
      issuer: this.config.get("JWT_ISSUER", { infer: true }), audience: this.config.get("JWT_AUDIENCE", { infer: true }),
    });
    const refreshToken = randomBytes(48).toString("base64url");
    await writer.refreshToken.create({ data: { tokenHash: hashToken(refreshToken), familyId, userId: user.id, expiresAt } });
    return { token, refreshToken };
  }

  async register(input: RegisterDto, requestId?: string): Promise<AuthUserResponseDto> {
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException("Email already registered");
    const role = await this.prisma.role.findUnique({ where: { name: "user" } });
    if (!role) throw new Error("Default user role has not been seeded");
    const password = await bcrypt.hash(input.password, 12);
    const user = await this.audit.transact(async (tx) => {
      const created = await tx.user.create({ data: { email, password, roleId: role.id }, include: { role: true } });
      return [created, { endpointId: "auth.register", policy: this.policy.for("auth.register"), behavior: "created",
        module: "auth", entityId: created.id, after: { id: created.id, email: created.email, role: created.role.name },
        ...(requestId ? { requestId } : {}) }] as const;
    });
    return this.toUser(user);
  }

  async login(input: LoginDto, requestId?: string): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(input.email) }, include: { role: true } });
    if (!user || user.deletedAt || !(await bcrypt.compare(input.password, user.password))) throw new UnauthorizedException("Invalid credentials");
    const policy = this.policy.for("auth.login");
    const change = { endpointId: "auth.login" as const, policy, behavior: "login",
        module: "auth", entityId: user.id, actor: { id: user.id, email: user.email, roleId: user.roleId },
        ...(requestId ? { requestId } : {}) };
    const result = await this.prisma.$transaction(async (tx) => {
      const tokens = await this.issue(user, randomUUID(), new Date(Date.now() + REFRESH_DAYS * 86400000), tx);
      if (policy.audit === "required") await this.audit.write(change, tx);
      return tokens;
    });
    if (policy.audit === "optional") await this.audit.write(change);
    return result;
  }

  async refresh(value: string, requestId?: string): Promise<AuthResponseDto> {
    const tokenHash = hashToken(value);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: { include: { role: true } } } });
    if (!existing) throw new UnauthorizedException("Invalid refresh token");
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Refresh token replay detected");
    }
    if (existing.expiresAt <= new Date() || existing.user.deletedAt) throw new UnauthorizedException("Refresh token expired");
    const refreshToken = randomBytes(48).toString("base64url");
    try {
      await this.audit.transact(async (tx) => {
        const changed = await tx.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
        if (changed.count !== 1) throw new RefreshReplayError();
        await tx.refreshToken.create({ data: { tokenHash: hashToken(refreshToken), familyId: existing.familyId,
          userId: existing.userId, expiresAt: existing.expiresAt } });
        return [undefined, { endpointId: "auth.refresh", policy: this.policy.for("auth.refresh"), behavior: "refresh",
          module: "auth", entityId: existing.userId,
          actor: { id: existing.user.id, email: existing.user.email, roleId: existing.user.roleId },
          ...(requestId ? { requestId } : {}) }] as const;
      });
    } catch (error) {
      if (error instanceof RefreshReplayError) {
        await this.prisma.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        throw new UnauthorizedException("Refresh token replay detected");
      }
      throw error;
    }
    const token = await this.jwt.signAsync({ sub: existing.user.id, tokenUse: "access" }, {
      secret: this.config.get("JWT_SECRET", { infer: true }), algorithm: "HS256", expiresIn: "15m",
      issuer: this.config.get("JWT_ISSUER", { infer: true }), audience: this.config.get("JWT_AUDIENCE", { infer: true }),
    });
    return { token, refreshToken };
  }

  async me(actor: Actor): Promise<AuthUserResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: { role: true } });
    return this.toUser(user);
  }

  async logout(value: string, requestId?: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(value) }, include: { user: true } });
    if (!existing || existing.revokedAt) return;
    await this.audit.transact(async (tx) => {
      await tx.refreshToken.updateMany({ where: { familyId: existing.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      return [undefined, { endpointId: "auth.logout", policy: this.policy.for("auth.logout"), behavior: "logout", module: "auth",
        entityId: existing.userId, actor: { id: existing.user.id, email: existing.user.email, roleId: existing.user.roleId },
        ...(requestId ? { requestId } : {}) }] as const;
    });
  }
}
