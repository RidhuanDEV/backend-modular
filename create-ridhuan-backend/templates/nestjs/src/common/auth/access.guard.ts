import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import type { AppConfig } from "../../config/env.validation";
import { PrismaService } from "../../platform/database/prisma.service";
import { ENDPOINT_ID_METADATA, EndpointPolicyService, type EndpointId } from "../endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../http/request-context";
import { RateLimitService } from "../rate-limit/rate-limit.service";

interface AccessClaims { sub: string; tokenUse: string; iss: string; aud: string | string[]; exp: number; }

@Injectable()
export class PreAuthRateGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly policy: EndpointPolicyService,
    private readonly rate: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const id = this.reflector.get<EndpointId>(ENDPOINT_ID_METADATA, context.getHandler());
    if (!id) throw new Error("Missing endpoint ID metadata");
    const request = context.switchToHttp().getRequest<ApiRequest>();
    request.endpointId = id;
    if (id === "health.get" || id === "live.get" || id === "ready.get") return true;
    const address = request.ip || request.socket.remoteAddress || "unknown";
    await this.rate.consume("public", address);
    if (this.policy.for(id).rateLimit === "auth") await this.rate.consume("auth", address);
    return true;
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly policy: EndpointPolicyService,
    private readonly jwt: JwtService, private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService, private readonly rate: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const id = this.reflector.get<EndpointId>(ENDPOINT_ID_METADATA, context.getHandler());
    if (!id) throw new Error("Missing endpoint ID metadata");
    const policy = this.policy.for(id);
    if (policy.public) return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const header = request.header("authorization");
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Bearer token required");
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7), {
        secret: this.config.get("JWT_SECRET", { infer: true }),
        algorithms: ["HS256"], issuer: this.config.get("JWT_ISSUER", { infer: true }),
        audience: this.config.get("JWT_AUDIENCE", { infer: true }),
      });
    } catch { throw new UnauthorizedException("Invalid access token"); }
    if (claims.tokenUse !== "access" || !claims.sub || !Number.isInteger(claims.exp)) throw new UnauthorizedException("Invalid access token");
    const user = await this.prisma.user.findFirst({ where: { id: claims.sub, deletedAt: null }, select: { id: true, email: true, roleId: true } });
    if (!user) throw new UnauthorizedException("User no longer active");
    const actor: Actor = { id: user.id, email: user.email, roleId: user.roleId };
    request.actor = actor;
    request.accessExpiresAt = claims.exp * 1000;
    if (policy.permission) {
      const granted = await this.prisma.rolePermission.count({ where: { roleId: actor.roleId, permission: { name: policy.permission } } });
      if (granted === 0) throw new ForbiddenException("Permission denied");
    }
    if (policy.rateLimit === "internal") await this.rate.consume("internal", actor.id);
    return true;
  }
}
