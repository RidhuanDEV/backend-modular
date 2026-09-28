package httpapi

import (
	"context"
)

func (s *Server) mountPermissions() {
	register[Empty, []Permission](s, "permission.list", func(ctx context.Context, input *Empty, _ *Actor) (Success[[]Permission], error) {
		permissions, err := s.Permissions.List(ctx)
		return ok(permissions), err
	})
	register[IDInput, Permission](s, "permission.get", func(ctx context.Context, input *IDInput, _ *Actor) (Success[Permission], error) {
		permission, err := s.Permissions.Get(ctx, input.ID)
		return ok(permission), err
	})
	register[NamedInput, Permission](s, "permission.create", func(ctx context.Context, input *NamedInput, actor *Actor) (Success[Permission], error) {
		b := input.Body
		permission, err := s.Permissions.Create(ctx, s.policy(ctx, "permission.create"), actor, b.Name)
		return ok(permission), err
	})
	register[UpdatePermissionInput, Permission](s, "permission.update", func(ctx context.Context, input *UpdatePermissionInput, actor *Actor) (Success[Permission], error) {
		b := input.Body
		permission, err := s.Permissions.Update(ctx, s.policy(ctx, "permission.update"), actor, input.ID, b.Name)
		return ok(permission), err
	})
	register[IDInput, Empty](s, "permission.delete", func(ctx context.Context, input *IDInput, actor *Actor) (Success[Empty], error) {
		return ok(Empty{}), s.Permissions.Delete(ctx, s.policy(ctx, "permission.delete"), actor, input.ID)
	})

}
