import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../errors/http-error.js";

const COOKIE_PATH = "/api/auth";
// Matches the refresh token lifetime; the server still enforces the real expiry.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie).
 * The token never reaches JavaScript, and because browsers attach cookies automatically,
 * cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom
 * header forces a CORS preflight, so only allowlisted origins can send it.
 */
export const refreshCookieEnabled = (): boolean =>
  env.REFRESH_TOKEN_TRANSPORT === "cookie";

const options = () => ({
  httpOnly: true,
  secure: env.REFRESH_COOKIE_SECURE,
  sameSite: env.REFRESH_COOKIE_SAMESITE,
  path: COOKIE_PATH,
  ...(env.REFRESH_COOKIE_DOMAIN ? { domain: env.REFRESH_COOKIE_DOMAIN } : {}),
});

/** Sets the cookie and strips the token from the body in cookie mode. */
export function issueTokens(
  res: Response,
  tokens: { token: string; refreshToken: string },
): { token: string; refreshToken?: string } {
  if (!refreshCookieEnabled()) return tokens;
  res.cookie(env.REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...options(),
    maxAge: COOKIE_MAX_AGE_MS,
  });
  return { token: tokens.token };
}

export function clearRefreshCookie(res: Response): void {
  if (refreshCookieEnabled())
    res.clearCookie(env.REFRESH_COOKIE_NAME, options());
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
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

/** A body token always wins; otherwise cookie mode reads the httpOnly cookie. */
export function refreshTokenFrom(req: Request, bodyToken?: string): string {
  if (bodyToken) return bodyToken;
  if (refreshCookieEnabled()) {
    const token = cookieValue(req, env.REFRESH_COOKIE_NAME);
    if (token) {
      if (!req.get("X-Requested-With"))
        throw HttpError.forbidden(
          "Cookie-based refresh requires the X-Requested-With header",
        );
      return token;
    }
  }
  throw HttpError.badRequest("refreshToken is required");
}
