import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { AppConfig } from "../../config/env.validation";
import { RefreshCookie } from "../../common/http/refresh-cookie";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type Success } from "../../common/http/response";
import { AuthService } from "./auth.service";
import { RateLimitService } from "../../common/rate-limit/rate-limit.service";
import {
  AuthResponseDto,
  AuthUserResponseDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from "./dto/auth.dto";

@ApiTags("auth")
@Controller("api/auth")
export class AuthController {
  private readonly cookie: RefreshCookie;
  constructor(
    private readonly service: AuthService,
    private readonly rate: RateLimitService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookie = new RefreshCookie({
      REFRESH_TOKEN_TRANSPORT: config.get("REFRESH_TOKEN_TRANSPORT", {
        infer: true,
      }),
      REFRESH_COOKIE_NAME: config.get("REFRESH_COOKIE_NAME", { infer: true }),
      REFRESH_COOKIE_SAMESITE: config.get("REFRESH_COOKIE_SAMESITE", {
        infer: true,
      }),
      REFRESH_COOKIE_DOMAIN: config.get("REFRESH_COOKIE_DOMAIN", {
        infer: true,
      }),
      REFRESH_COOKIE_SECURE: config.get("REFRESH_COOKIE_SECURE", {
        infer: true,
      }),
    });
  }
  @Post("register")
  @Endpoint("auth.register")
  async register(
    @Body() dto: RegisterDto,
    @Req() req: ApiRequest,
  ): Promise<Success<AuthUserResponseDto>> {
    return success(await this.service.register(dto, req.requestId));
  }
  @Post("login")
  @HttpCode(200)
  @Endpoint("auth.login")
  async login(
    @Body() dto: LoginDto,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Success<AuthResponseDto>> {
    // Per target account as well as per IP, so credential stuffing across many IPs still hits a ceiling.
    await this.rate.consume(
      "auth",
      `account:${dto.email.trim().toLowerCase()}`,
    );
    return success(
      this.cookie.issue(res, await this.service.login(dto, req.requestId)),
    );
  }
  @Post("refresh")
  @HttpCode(200)
  @Endpoint("auth.refresh")
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Success<AuthResponseDto>> {
    const tokens = await this.service.refresh(
      this.cookie.token(req, dto.refreshToken),
      req.requestId,
    );
    return success(this.cookie.issue(res, tokens));
  }
  @Post("logout")
  @HttpCode(204)
  @Endpoint("auth.logout")
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.service.logout(
      this.cookie.token(req, dto.refreshToken),
      req.requestId,
    );
    this.cookie.clear(res);
  }
  @Get("me")
  @ApiBearerAuth()
  @Endpoint("auth.me")
  async me(
    @CurrentActor() actor: Actor,
  ): Promise<Success<AuthUserResponseDto>> {
    return success(await this.service.me(actor));
  }
}
