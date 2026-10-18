package httpapi

import (
	"context"
)

func (s *Server) mountAuth() {
	register[RegisterInput, AuthUser](s, "auth.register", func(ctx context.Context, input *RegisterInput, _ *Actor) (Success[AuthUser], error) {
		b := input.Body
		user, err := s.Auth.Register(ctx, s.policy(ctx, "auth.register"), Credentials{Email: b.Email, Password: b.Password})
		return ok(publicAuthUser(user)), err
	})
	register[CredentialsInput, Token](s, "auth.login", func(ctx context.Context, input *CredentialsInput, _ *Actor) (Success[Token], error) {
		b := input.Body
		pair, err := s.Auth.Login(ctx, s.policy(ctx, "auth.login"), b)
		if err != nil {
			return Success[Token]{}, err
		}
		return ok(s.issueTokens(ctx, pair)), nil
	})
	register[RefreshInput, Token](s, "auth.refresh", func(ctx context.Context, input *RefreshInput, _ *Actor) (Success[Token], error) {
		raw, err := s.refreshTokenFrom(ctx, input.Body.RefreshToken)
		if err != nil {
			return Success[Token]{}, err
		}
		pair, err := s.Auth.Refresh(ctx, s.policy(ctx, "auth.refresh"), raw)
		if err != nil {
			return Success[Token]{}, err
		}
		return ok(s.issueTokens(ctx, pair)), nil
	})
	register[RefreshInput, struct{}](s, "auth.logout", func(ctx context.Context, input *RefreshInput, _ *Actor) (Success[struct{}], error) {
		raw, err := s.refreshTokenFrom(ctx, input.Body.RefreshToken)
		if err != nil {
			return Success[struct{}]{}, err
		}
		if err = s.Auth.Logout(ctx, s.policy(ctx, "auth.logout"), raw); err != nil {
			return Success[struct{}]{}, err
		}
		s.clearRefreshCookie(ctx)
		return Success[struct{}]{}, nil
	})
	register[Empty, AuthUser](s, "auth.me", func(ctx context.Context, input *Empty, actor *Actor) (Success[AuthUser], error) {
		user, err := s.Auth.Me(ctx, actor)
		return ok(publicAuthUser(user)), err
	})

}
