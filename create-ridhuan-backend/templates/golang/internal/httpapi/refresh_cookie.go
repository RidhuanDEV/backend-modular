package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/model"
)

type writerKey struct{}

const refreshCookiePath = "/api/auth"

// refreshCookieMaxAge matches the refresh token lifetime; the server still enforces the real expiry.
const refreshCookieMaxAge = 30 * 24 * time.Hour

// Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie).
// The token never reaches JavaScript, and because browsers attach cookies automatically,
// cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom
// header forces a CORS preflight, so only allowlisted origins can send it.
func (s *Server) refreshCookieEnabled() bool { return s.Config.RefreshTransport == "cookie" }

func (s *Server) refreshCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     s.Config.RefreshCookieName,
		Value:    value,
		Path:     refreshCookiePath,
		Domain:   s.Config.RefreshCookieDomain,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.Config.RefreshCookieSecure,
		SameSite: s.Config.RefreshCookieSameSite,
	}
}

// issueTokens sets the cookie and strips the token from the body in cookie mode.
func (s *Server) issueTokens(ctx context.Context, pair model.TokenPair) TokenResponse {
	response := tokenResponse(pair)
	if !s.refreshCookieEnabled() {
		return response
	}
	if w, ok := ctx.Value(writerKey{}).(http.ResponseWriter); ok {
		http.SetCookie(w, s.refreshCookie(pair.RefreshToken, int(refreshCookieMaxAge.Seconds())))
	}
	response.RefreshToken = ""
	return response
}

func (s *Server) clearRefreshCookie(ctx context.Context) {
	if !s.refreshCookieEnabled() {
		return
	}
	if w, ok := ctx.Value(writerKey{}).(http.ResponseWriter); ok {
		http.SetCookie(w, s.refreshCookie("", -1))
	}
}

// refreshTokenFrom prefers a body token; otherwise cookie mode reads the httpOnly cookie.
func (s *Server) refreshTokenFrom(ctx context.Context, bodyToken string) (string, error) {
	if bodyToken != "" {
		return bodyToken, nil
	}
	if r, ok := ctx.Value(requestKey{}).(*http.Request); ok && s.refreshCookieEnabled() {
		if cookie, err := r.Cookie(s.Config.RefreshCookieName); err == nil && cookie.Value != "" {
			if r.Header.Get("X-Requested-With") == "" {
				return "", &APIError{Status: http.StatusForbidden, Message: "Cookie-based refresh requires the X-Requested-With header", Errors: []string{}}
			}
			return cookie.Value, nil
		}
	}
	return "", badRequest("refreshToken is required")
}
