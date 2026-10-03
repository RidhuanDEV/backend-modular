import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { mergeMap, type Observable } from "rxjs";
import {
  ENDPOINT_ID_METADATA,
  EndpointPolicyService,
  type EndpointId,
} from "../endpoint/endpoint.registry";
import type { ApiRequest } from "../http/request-context";
import { AuditService } from "./audit.service";

@Injectable()
export class ReadAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: EndpointPolicyService,
    private readonly audit: AuditService,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const id = this.reflector.get<EndpointId>(
      ENDPOINT_ID_METADATA,
      context.getHandler(),
    );
    if (!id) throw new Error("Missing endpoint metadata");
    const policy = this.policy.for(id);
    if (policy.method !== "GET" || policy.audit !== "optional")
      return next.handle();
    const request = context.switchToHttp().getRequest<ApiRequest>();
    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        await this.audit.write({
          endpointId: id,
          policy,
          behavior: "read",
          module: policy.module,
          ...(request.actor ? { actor: request.actor } : {}),
          ...(request.requestId ? { requestId: request.requestId } : {}),
        });
        return data;
      }),
    );
  }
}
