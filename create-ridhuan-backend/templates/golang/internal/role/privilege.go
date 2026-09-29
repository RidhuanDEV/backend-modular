package role

import (
	"context"
	"slices"

	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
)

// RootRole is the seeded root role. It is exempt because it must be able to
// hand out permissions created after seeding, which it does not hold itself.
const RootRole = "admin"

// PermissionsWithinActor enforces the anti-escalation rule: an actor may only
// grant, assign or manage permissions it already holds. Route permissions
// (manage_users, manage_roles) decide who may call an endpoint; this decides
// what they may hand out through it.
func PermissionsWithinActor(ctx context.Context, q *sqlc.Queries, actor *audit.Actor, permissionIDs []string) error {
	if len(permissionIDs) == 0 {
		return nil
	}
	if actor == nil {
		return fault.New(fault.Forbidden, "Forbidden")
	}
	actorRole, err := q.FindRole(ctx, actor.RoleID)
	if err != nil {
		return fault.DB(err)
	}
	if actorRole.Name == RootRole {
		return nil
	}
	held, err := q.ListRolePermissionIDs(ctx, actor.RoleID)
	if err != nil {
		return fault.DB(err)
	}
	for _, id := range permissionIDs {
		if !slices.Contains(held, id) {
			return fault.New(fault.Forbidden, "You cannot grant or manage permissions you do not hold")
		}
	}
	return nil
}

// RoleWithinActor applies PermissionsWithinActor to every permission of roleID.
func RoleWithinActor(ctx context.Context, q *sqlc.Queries, actor *audit.Actor, roleID string) error {
	if actor != nil && actor.RoleID == roleID {
		return nil
	}
	ids, err := q.ListRolePermissionIDs(ctx, roleID)
	if err != nil {
		return fault.DB(err)
	}
	return PermissionsWithinActor(ctx, q, actor, ids)
}
