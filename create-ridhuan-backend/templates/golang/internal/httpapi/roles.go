package httpapi

import (
	"context"
)

func (s *Server) mountRoles() {
	register[Empty, []Role](s, "role.list", func(ctx context.Context, input *Empty, _ *Actor) (Success[[]Role], error) {
		roles, err := s.Roles.List(ctx)
		return ok(roles), err
	})
	register[IDInput, Role](s, "role.get", func(ctx context.Context, input *IDInput, _ *Actor) (Success[Role], error) {
		role, err := s.Roles.Get(ctx, input.ID)
		return ok(role), err
	})
	register[RoleInput, BaseRole](s, "role.create", func(ctx context.Context, input *RoleInput, actor *Actor) (Success[BaseRole], error) {
		b := input.Body
		role, err := s.Roles.Create(ctx, s.policy(ctx, "role.create"), actor, b.Name)
		return ok(baseRole(role)), err
	})
	register[UpdateRoleInput, BaseRole](s, "role.update", func(ctx context.Context, input *UpdateRoleInput, actor *Actor) (Success[BaseRole], error) {
		b := input.Body
		role, err := s.Roles.Update(ctx, s.policy(ctx, "role.update"), actor, input.ID, b.Name)
		return ok(baseRole(role)), err
	})
	register[IDInput, Empty](s, "role.delete", func(ctx context.Context, input *IDInput, actor *Actor) (Success[Empty], error) {
		return ok(Empty{}), s.Roles.Delete(ctx, s.policy(ctx, "role.delete"), actor, input.ID)
	})
	register[AssignmentInput, Role](s, "role.assignPermissions", func(ctx context.Context, input *AssignmentInput, actor *Actor) (Success[Role], error) {
		b := input.Body
		role, err := s.Roles.Assign(ctx, s.policy(ctx, "role.assignPermissions"), actor, input.ID, b.PermissionIDs)
		return ok(role), err
	})

}
