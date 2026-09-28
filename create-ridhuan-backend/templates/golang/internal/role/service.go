package role

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"slices"
	"strings"
	"time"
)

type Service struct {
	Queries *sqlc.Queries
	Audit   *audit.Writer
}

func (s *Service) Get(ctx context.Context, id string) (model.Role, error) {
	if err := fault.UUID(id); err != nil {
		return model.Role{}, err
	}
	row, err := s.Queries.FindRole(ctx, id)
	if err != nil {
		return model.Role{}, fault.DB(err)
	}
	out := projection.Role(row)
	permissions, err := s.Queries.ListRolePermissions(ctx, id)
	if err != nil {
		return out, fault.DB(err)
	}
	for _, p := range permissions {
		out.Permissions = append(out.Permissions, model.RolePermission{Permission: model.NamedPermission{ID: p.ID, Name: p.Name}})
	}
	return out, nil
}
func (s *Service) List(ctx context.Context) ([]model.Role, error) {
	rows, err := s.Queries.ListRoles(ctx)
	if err != nil {
		return nil, fault.DB(err)
	}
	out := make([]model.Role, 0, len(rows))
	for _, row := range rows {
		value, err := s.Get(ctx, row.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, nil
}
func (s *Service) Create(ctx context.Context, p audit.Policy, actor *audit.Actor, name string) (model.Role, error) {
	if err := fault.Name(name, 64); err != nil {
		return model.Role{}, err
	}
	return audit.Mutate(ctx, s.Audit, p, actor, "CREATE", func(q *sqlc.Queries) (model.Role, audit.Change, error) {
		row, err := q.CreateRole(ctx, strings.TrimSpace(name))
		if err != nil {
			return model.Role{}, audit.Change{}, fault.DB(err)
		}
		out := projection.Role(row)
		change, err := audit.Capture(out.ID, (*roleSnapshot)(nil), snapshot(out))
		return out, change, err
	})
}
func (s *Service) Update(ctx context.Context, p audit.Policy, actor *audit.Actor, id string, name *string) (model.Role, error) {
	if err := fault.UUID(id); err != nil {
		return model.Role{}, err
	}
	if name != nil {
		if err := fault.Name(*name, 64); err != nil {
			return model.Role{}, err
		}
	}
	return audit.Mutate(ctx, s.Audit, p, actor, "UPDATE", func(q *sqlc.Queries) (model.Role, audit.Change, error) {
		old, err := q.LockRole(ctx, id)
		if err != nil {
			return model.Role{}, audit.Change{}, fault.DB(err)
		}
		newName := old.Name
		if name != nil {
			newName = strings.TrimSpace(*name)
		}
		row, err := q.UpdateRole(ctx, sqlc.UpdateRoleParams{ID: id, Name: newName})
		if err != nil {
			return model.Role{}, audit.Change{}, fault.DB(err)
		}
		before, out := projection.Role(old), projection.Role(row)
		change, err := audit.Capture(id, snapshot(before), snapshot(out))
		return out, change, err
	})
}
func (s *Service) Delete(ctx context.Context, p audit.Policy, actor *audit.Actor, id string) error {
	if err := fault.UUID(id); err != nil {
		return err
	}
	_, err := audit.Mutate(ctx, s.Audit, p, actor, "DELETE", func(q *sqlc.Queries) (struct{}, audit.Change, error) {
		row, err := q.LockRole(ctx, id)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		if err = q.DeleteRole(ctx, id); err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		before := projection.Role(row)
		change, err := audit.Capture(id, snapshot(before), (*roleSnapshot)(nil))
		return struct{}{}, change, err
	})
	return err
}

type assignmentSnapshot struct {
	Name          string   `json:"name"`
	PermissionIDs []string `json:"permissionIds"`
}

func (s *Service) Assign(ctx context.Context, p audit.Policy, actor *audit.Actor, id string, ids []string) (model.Role, error) {
	if err := fault.UUID(id); err != nil {
		return model.Role{}, err
	}
	if len(ids) == 0 {
		return model.Role{}, fault.New(fault.Invalid, "permissionIds is required")
	}
	for _, v := range ids {
		if err := fault.UUID(v); err != nil {
			return model.Role{}, err
		}
	}
	ids = slices.Clone(ids)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	_, err := audit.Mutate(ctx, s.Audit, p, actor, "UPDATE", func(q *sqlc.Queries) (struct{}, audit.Change, error) {
		row, err := q.LockRole(ctx, id)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		old, err := q.ListRolePermissionIDs(ctx, id)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		if err = q.ClearRolePermissions(ctx, id); err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		for _, v := range ids {
			if err = q.AssignRolePermission(ctx, sqlc.AssignRolePermissionParams{RoleID: id, PermissionID: v}); err != nil {
				return struct{}{}, audit.Change{}, fault.DB(err)
			}
		}
		before, after := assignmentSnapshot{row.Name, old}, assignmentSnapshot{row.Name, ids}
		change, err := audit.Capture(id, &before, &after)
		return struct{}{}, change, err
	})
	if err != nil {
		return model.Role{}, err
	}
	return s.Get(ctx, id)
}

type roleSnapshot struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func snapshot(r model.Role) *roleSnapshot {
	return &roleSnapshot{r.ID, r.Name, r.CreatedAt, r.UpdatedAt}
}
