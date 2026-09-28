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
		return ok(tokenResponse(pair)), err
	})
	register[RefreshInput, Token](s, "auth.refresh", func(ctx context.Context, input *RefreshInput, _ *Actor) (Success[Token], error) {
		pair, err := s.Auth.Refresh(ctx, s.policy(ctx, "auth.refresh"), input.Body.RefreshToken)
		return ok(tokenResponse(pair)), err
	})
	register[Empty, AuthUser](s, "auth.me", func(ctx context.Context, input *Empty, actor *Actor) (Success[AuthUser], error) {
		user, err := s.Auth.Me(ctx, actor)
		return ok(publicAuthUser(user)), err
	})

}
