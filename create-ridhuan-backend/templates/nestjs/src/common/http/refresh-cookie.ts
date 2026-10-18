import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/env.validation";

const COOKIE_PATH = "/api/auth";
// Matches the refresh token lifetime; the server still enforces the real expiry.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type CookieConfig = Pick<
  AppConfig,
  | "REFRESH_TOKEN_TRANSPORT"
  | "REFRESH_COOKIE_NAME"
  | "REFRESH_COOKIE_SAMESITE"
  | "REFRESH_COOKIE_DOMAIN"
  | "REFRESH_COOKIE_SECURE"
>;

/**
 * Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie).
 * The token never reaches JavaScript, and because browsers attach cookies automatically,
 * cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom
 * header forces a CORS preflight, so only allowlisted origins can send it.
 */
export class RefreshCookie {
  constructor(private readonly config: CookieConfig) {}

  get enabled(): boolean {
    return this.config.REFRESH_TOKEN_TRANSPORT === "cookie";
  }

  private options() {
    return {
      httpOnly: true,
      secure: this.config.REFRESH_COOKIE_SECURE,
      sameSite: this.config.REFRESH_COOKIE_SAMESITE,
      path: COOKIE_PATH,
      ...(this.config.REFRESH_COOKIE_DOMAIN
        ? { domain: this.config.REFRESH_COOKIE_DOMAIN }
        : {}),
    } as const;
  }

  /** Sets the cookie and strips the token from the body in cookie mode. */
  issue(
    response: Response,
    tokens: { token: string; refreshToken: string },
  ): { token: string; refreshToken?: string } {
    if (!this.enabled) return tokens;
    response.cookie(this.config.REFRESH_COOKIE_NAME, tokens.refreshToken, {
      ...this.options(),
      maxAge: COOKIE_MAX_AGE_MS,
    });
    return { token: tokens.token };
  }

  clear(response: Response): void {
    if (this.enabled)
      response.clearCookie(this.config.REFRESH_COOKIE_NAME, this.options());
  }

  /** A body token always wins; otherwise cookie mode reads the httpOnly cookie. */
  token(request: Request, bodyToken?: string): string {
    if (bodyToken) return bodyToken;
    if (this.enabled) {
      const token = cookieValue(request, this.config.REFRESH_COOKIE_NAME);
      if (token) {
        if (!request.get("X-Requested-With"))
          throw new ForbiddenException(
            "Cookie-based refresh requires the X-Requested-With header",
          );
        return token;
      }
    }
    throw new BadRequestException("refreshToken is required");
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
