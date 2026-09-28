package permission

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"strings"
)

type Service struct {
	Queries *sqlc.Queries
	Audit   *audit.Writer
}

func (s *Service) Get(ctx context.Context, id string) (model.Permission, error) {
	if err := fault.UUID(id); err != nil {
		return model.Permission{}, err
	}
	row, err := s.Queries.FindPermission(ctx, id)
	return projection.Permission(row), fault.DB(err)
}
func (s *Service) List(ctx context.Context) ([]model.Permission, error) {
	rows, err := s.Queries.ListPermissions(ctx)
	if err != nil {
		return nil, fault.DB(err)
	}
	out := make([]model.Permission, 0, len(rows))
	for _, r := range rows {
		out = append(out, projection.Permission(r))
	}
	return out, nil
}
func (s *Service) Create(ctx context.Context, p audit.Policy, actor *audit.Actor, name string) (model.Permission, error) {
	if err := fault.Name(name, 128); err != nil {
		return model.Permission{}, err
	}
	return audit.Mutate(ctx, s.Audit, p, actor, "CREATE", func(q *sqlc.Queries) (model.Permission, audit.Change, error) {
		row, err := q.CreatePermission(ctx, strings.TrimSpace(name))
		if err != nil {
			return model.Permission{}, audit.Change{}, fault.DB(err)
		}
		out := projection.Permission(row)
		change, err := audit.Capture(out.ID, (*model.Permission)(nil), &out)
		return out, change, err
	})
}
func (s *Service) Update(ctx context.Context, p audit.Policy, actor *audit.Actor, id string, name *string) (model.Permission, error) {
	if err := fault.UUID(id); err != nil {
		return model.Permission{}, err
	}
	if name != nil {
		if err := fault.Name(*name, 128); err != nil {
			return model.Permission{}, err
		}
	}
	return audit.Mutate(ctx, s.Audit, p, actor, "UPDATE", func(q *sqlc.Queries) (model.Permission, audit.Change, error) {
		old, err := q.LockPermission(ctx, id)
		if err != nil {
			return model.Permission{}, audit.Change{}, fault.DB(err)
		}
		newName := old.Name
		if name != nil {
			newName = strings.TrimSpace(*name)
		}
		row, err := q.UpdatePermission(ctx, sqlc.UpdatePermissionParams{ID: id, Name: newName})
		if err != nil {
			return model.Permission{}, audit.Change{}, fault.DB(err)
		}
		before, out := projection.Permission(old), projection.Permission(row)
		change, err := audit.Capture(id, &before, &out)
		return out, change, err
	})
}
func (s *Service) Delete(ctx context.Context, p audit.Policy, actor *audit.Actor, id string) error {
	if err := fault.UUID(id); err != nil {
		return err
	}
	_, err := audit.Mutate(ctx, s.Audit, p, actor, "DELETE", func(q *sqlc.Queries) (struct{}, audit.Change, error) {
		row, err := q.LockPermission(ctx, id)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		if err = q.DeletePermission(ctx, id); err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		before := projection.Permission(row)
		change, err := audit.Capture(id, &before, (*model.Permission)(nil))
		return struct{}{}, change, err
	})
	return err
}
