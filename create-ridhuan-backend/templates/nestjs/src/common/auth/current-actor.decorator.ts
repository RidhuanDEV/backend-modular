import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import type { Actor, ApiRequest } from "../http/request-context";

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<ApiRequest>().actor;
    if (!actor) throw new UnauthorizedException();
    return actor;
  },
);
