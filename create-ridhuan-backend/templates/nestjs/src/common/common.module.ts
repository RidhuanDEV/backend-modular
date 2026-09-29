import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditService } from "./audit/audit.service";
import { CacheService } from "./cache/cache.service";
import { EndpointPolicyService } from "./endpoint/endpoint.registry";
import { RateLimitService } from "./rate-limit/rate-limit.service";

@Global()
@Module({ imports: [JwtModule.register({ global: true })], providers: [EndpointPolicyService, AuditService, CacheService, RateLimitService],
  exports: [EndpointPolicyService, AuditService, CacheService, RateLimitService, JwtModule] })
export class CommonModule {}
