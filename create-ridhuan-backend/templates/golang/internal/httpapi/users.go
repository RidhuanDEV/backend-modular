package httpapi

import (
	"context"
)

func (s *Server) mountUsers() {
	register[UserListInput, []UserProjection](s, "user.list", func(ctx context.Context, input *UserListInput, _ *Actor) (Success[[]UserProjection], error) {
		users, meta, err := s.Users.List(ctx, input.Page, input.Limit, input.Search, input.SortBy, input.OrderBy)
		if err != nil {
			return Success[[]UserProjection]{}, err
		}
		projected, err := projectUsers(users, input.Fields)
		out := ok(projected)
		out.Meta = &meta
		return out, err
	})
	register[IDInput, UserResponse](s, "user.get", func(ctx context.Context, input *IDInput, _ *Actor) (Success[UserResponse], error) {
		user, err := s.Users.Get(ctx, input.ID)
		return ok(publicUser(user)), err
	})
	register[UserInput, UserResponse](s, "user.create", func(ctx context.Context, input *UserInput, actor *Actor) (Success[UserResponse], error) {
		b := input.Body
		user, err := s.Users.Create(ctx, s.policy(ctx, "user.create"), actor, b)
		return ok(publicUser(user)), err
	})
	register[UpdateUserInput, UserResponse](s, "user.update", func(ctx context.Context, input *UpdateUserInput, actor *Actor) (Success[UserResponse], error) {
		b := input.Body
		user, err := s.Users.Update(ctx, s.policy(ctx, "user.update"), actor, input.ID, b)
		return ok(publicUser(user)), err
	})
	register[IDInput, Empty](s, "user.delete", func(ctx context.Context, input *IDInput, actor *Actor) (Success[Empty], error) {
		return ok(Empty{}), s.Users.Delete(ctx, s.policy(ctx, "user.delete"), actor, input.ID)
	})

}
