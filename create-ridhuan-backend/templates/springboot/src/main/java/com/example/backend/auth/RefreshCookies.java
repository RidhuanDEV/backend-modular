package com.example.backend.auth;

import com.example.backend.config.Settings;
import com.example.backend.platform.http.ApiException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie). The
 * token never reaches JavaScript, and because browsers attach cookies automatically,
 * cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom header forces
 * a CORS preflight, so only allowlisted origins can send it.
 */
@Component
public class RefreshCookies {
  private static final String PATH = "/api/auth";
  // Matches the refresh token lifetime; the server still enforces the real expiry.
  private static final Duration MAX_AGE = Duration.ofDays(30);

  private final boolean enabled;
  private final String name;
  private final String sameSite;
  private final @Nullable String domain;
  private final boolean secure;

  public RefreshCookies(Settings settings) {
    String transport = settings.text("REFRESH_TOKEN_TRANSPORT", "body");
    if (!Set.of("body", "cookie").contains(transport))
      throw new IllegalArgumentException("Invalid setting REFRESH_TOKEN_TRANSPORT");
    enabled = transport.equals("cookie");
    name = settings.text("REFRESH_COOKIE_NAME", "refresh_token");
    if (!name.matches("[A-Za-z0-9_-]{1,64}"))
      throw new IllegalArgumentException("Invalid setting REFRESH_COOKIE_NAME");
    // lax/strict for same-site frontends (including sibling subdomains); none for cross-site.
    String site = settings.text("REFRESH_COOKIE_SAMESITE", "lax");
    sameSite =
        switch (site) {
          case "lax" -> "Lax";
          case "strict" -> "Strict";
          case "none" -> "None";
          default -> throw new IllegalArgumentException("Invalid setting REFRESH_COOKIE_SAMESITE");
        };
    String configured = settings.text("REFRESH_COOKIE_DOMAIN", "");
    if (!configured.isEmpty() && !configured.matches("\\.?[A-Za-z0-9.-]+"))
      throw new IllegalArgumentException("Invalid setting REFRESH_COOKIE_DOMAIN");
    domain = configured.isEmpty() ? null : configured;
    secure = settings.bool("REFRESH_COOKIE_SECURE", true);
    if (sameSite.equals("None") && !secure)
      throw new IllegalArgumentException("SameSite=None cookies must be Secure");
  }

  public boolean enabled() {
    return enabled;
  }

  private ResponseCookie cookie(String value, Duration maxAge) {
    var builder =
        ResponseCookie.from(name, value)
            .httpOnly(true)
            .secure(secure)
            .sameSite(sameSite)
            .path(PATH)
            .maxAge(maxAge);
    if (domain != null) builder.domain(domain);
    return builder.build();
  }

  /** Sets the cookie and strips the token from the body in cookie mode. */
  public AuthDto.TokenResponse issue(HttpServletResponse response, AuthDto.Tokens tokens) {
    if (!enabled) return new AuthDto.TokenResponse(tokens.token(), tokens.refreshToken());
    response.addHeader(HttpHeaders.SET_COOKIE, cookie(tokens.refreshToken(), MAX_AGE).toString());
    return new AuthDto.TokenResponse(tokens.token(), null);
  }

  public void clear(HttpServletResponse response) {
    if (enabled) response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
  }

  /** A body token always wins; otherwise cookie mode reads the httpOnly cookie. */
  public String token(HttpServletRequest request, @Nullable String bodyToken) {
    if (bodyToken != null && !bodyToken.isEmpty()) return bodyToken;
    if (enabled && request.getCookies() != null)
      for (Cookie cookie : request.getCookies())
        if (cookie.getName().equals(name) && !cookie.getValue().isEmpty()) {
          String header = request.getHeader("X-Requested-With");
          if (header == null || header.isEmpty())
            throw new ApiException(
                403, "Cookie-based refresh requires the X-Requested-With header");
          return cookie.getValue();
        }
    throw new ApiException(400, "refreshToken is required");
  }
}
