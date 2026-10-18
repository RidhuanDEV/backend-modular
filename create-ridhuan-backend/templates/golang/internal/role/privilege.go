package role

import (
	"context"
	"fmt"
	"slices"

	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
)

// RootRole is the seeded administrator role. Access is decided by RBAC
// permissions; only upload ownership trusts this role by name.
const RootRole = "admin"

// DefaultRole is assigned on registration, so the code depends on its name.
const DefaultRole = "user"

// SystemRoles are referenced by name in code and therefore cannot be renamed,
// deleted or recreated.
var SystemRoles = []string{RootRole, DefaultRole}

// SystemPermissions are checked by name on routes. Renaming or deleting one
// would let a permission manager mint access it was never granted. The
// registry test keeps this list in sync with every endpoint permission.
var SystemPermissions = []string{"manage_users", "manage_roles", "manage_permissions", "manage_uploads", "manage_notifications"}

// NotSystemName rejects creating, renaming or deleting a system role or permission.
func NotSystemName(names []string, kind, name string) error {
	if slices.Contains(names, name) {
		return fault.New(fault.Forbidden, fmt.Sprintf("System %s '%s' cannot be created, renamed or deleted", kind, name))
	}
	return nil
}

// PermissionsWithinActor enforces the anti-escalation rule: an actor may only
// grant, assign or manage permissions it already holds. Route permissions
// (manage_users, manage_roles) decide who may call an endpoint; this decides
// what they may hand out through it.
func PermissionsWithinActor(ctx context.Context, q sqlc.Querier, actor *audit.Actor, permissionIDs []string) error {
	if len(permissionIDs) == 0 {
		return nil
	}
	if actor == nil {
		return fault.New(fault.Forbidden, "Forbidden")
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
func RoleWithinActor(ctx context.Context, q sqlc.Querier, actor *audit.Actor, roleID string) error {
	if actor != nil && actor.RoleID == roleID {
		return nil
	}
	ids, err := q.ListRolePermissionIDs(ctx, roleID)
	if err != nil {
		return fault.DB(err)
	}
	return PermissionsWithinActor(ctx, q, actor, ids)
}

// IsRootRole reports whether roleID is the seeded administrator role.
func IsRootRole(ctx context.Context, q sqlc.Querier, roleID string) (bool, error) {
	r, err := q.FindRole(ctx, roleID)
	if err != nil {
		return false, fault.DB(err)
	}
	return r.Name == RootRole, nil
}

// GuardSystemPermissionHolders keeps every system permission held by at least
// one active user, or nobody could grant it again. It locks the system
// permission rows in a fixed order so concurrent RBAC mutations serialize under
// PostgreSQL and MySQL, and returns a check to run after the mutation in the
// same transaction. Only permissions that become unheld fail.
func GuardSystemPermissionHolders(ctx context.Context, q sqlc.Querier) (func() error, error) {
	for _, name := range SystemPermissions {
		if _, err := q.LockPermissionByName(ctx, name); err != nil {
			return nil, fault.DB(err)
		}
	}
	unheld := func() ([]string, error) {
		var names []string
		for _, name := range SystemPermissions {
			count, err := q.CountActivePermissionHolders(ctx, name)
			if err != nil {
				return nil, fault.DB(err)
			}
			if count == 0 {
				names = append(names, name)
			}
		}
		return names, nil
	}
	before, err := unheld()
	if err != nil {
		return nil, err
	}
	return func() error {
		after, err := unheld()
		if err != nil {
			return err
		}
		for _, name := range after {
			if !slices.Contains(before, name) {
				return fault.New(fault.Forbidden, fmt.Sprintf("Change would leave no active user holding '%s'", name))
			}
		}
		return nil
	}, nil
}

// GrantToPermissionManagers keeps permissions RBAC-only: a new permission goes
// to every role that manages permissions, so its creator and other permission
// managers can hand it out without a role-name exemption.
func GrantToPermissionManagers(ctx context.Context, q sqlc.Querier, permissionID string) error {
	roles, err := q.ListRoleIDsWithPermissionName(ctx, "manage_permissions")
	if err != nil {
		return fault.DB(err)
	}
	for _, roleID := range roles {
		if err = q.AssignRolePermission(ctx, sqlc.AssignRolePermissionParams{RoleID: roleID, PermissionID: permissionID}); err != nil {
			return fault.DB(err)
		}
	}
	return nil
}

// RevokeUserSessions forces re-authentication after the user's access changed.
func RevokeUserSessions(ctx context.Context, q sqlc.Querier, userID string) error {
	if err := q.RevokeUserRefreshFamilies(ctx, userID); err != nil {
		return fault.DB(err)
	}
	return fault.DB(q.RevokeUserAuthRefreshTokens(ctx, userID))
}
