import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type Success } from "../../common/http/response";
import { AuthService } from "./auth.service";
import { AuthResponseDto, AuthUserResponseDto, LoginDto, RefreshDto, RegisterDto } from "./dto/auth.dto";

@ApiTags("auth")
@Controller("api/auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post("register") @Endpoint("auth.register")
  async register(@Body() dto: RegisterDto, @Req() req: ApiRequest): Promise<Success<AuthUserResponseDto>> { return success(await this.service.register(dto, req.requestId)); }
  @Post("login") @HttpCode(200) @Endpoint("auth.login")
  async login(@Body() dto: LoginDto, @Req() req: ApiRequest): Promise<Success<AuthResponseDto>> { return success(await this.service.login(dto, req.requestId)); }
  @Post("refresh") @HttpCode(200) @Endpoint("auth.refresh")
  async refresh(@Body() dto: RefreshDto, @Req() req: ApiRequest): Promise<Success<AuthResponseDto>> { return success(await this.service.refresh(dto.refreshToken, req.requestId)); }
  @Post("logout") @HttpCode(204) @Endpoint("auth.logout")
  async logout(@Body() dto: RefreshDto, @Req() req: ApiRequest): Promise<void> {
    await this.service.logout(dto.refreshToken, req.requestId);
  }
  @Get("me") @ApiBearerAuth() @Endpoint("auth.me")
  async me(@CurrentActor() actor: Actor): Promise<Success<AuthUserResponseDto>> { return success(await this.service.me(actor)); }
}
