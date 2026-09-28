package user

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/RidhuanDEV/golang-backend/internal/role"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	Queries *sqlc.Queries
	Audit   *audit.Writer
	Roles   *role.Service
}

func (s *Service) enrich(ctx context.Context, out *model.User) error {
	r, err := s.Roles.Get(ctx, out.RoleID)
	if err != nil {
		return err
	}
	permissions := make([]model.NamedPermission, 0, len(r.Permissions))
	for _, p := range r.Permissions {
		permissions = append(permissions, p.Permission)
	}
	out.Role = &model.UserRole{ID: r.ID, Name: r.Name, Permissions: permissions}
	return nil
}
func (s *Service) Get(ctx context.Context, id string) (model.User, error) {
	if err := fault.UUID(id); err != nil {
		return model.User{}, err
	}
	row, err := s.Queries.FindUser(ctx, id)
	if err != nil {
		return model.User{}, fault.DB(err)
	}
	out := projection.User(row)
	return out, s.enrich(ctx, &out)
}
func (s *Service) List(ctx context.Context, page, limit int, search, sortBy, orderBy string) ([]model.User, model.Pagination, error) {
	if page < 1 || limit < 1 || limit > 100 || int64(page-1)*int64(limit) > 2147483647 {
		return nil, model.Pagination{}, fault.New(fault.Invalid, "Invalid pagination")
	}
	if sortBy == "" || sortBy == "created_at" {
		sortBy = "createdAt"
	}
	switch sortBy {
	case "createdAt", "updatedAt", "email":
	default:
		return nil, model.Pagination{}, fault.New(fault.Invalid, "Invalid sortBy")
	}
	if orderBy == "" {
		orderBy = "asc"
	}
	if orderBy != "asc" && orderBy != "desc" {
		return nil, model.Pagination{}, fault.New(fault.Invalid, "Invalid orderBy")
	}
	total, err := s.Queries.CountUsers(ctx, search)
	if err != nil {
		return nil, model.Pagination{}, fault.DB(err)
	}
	rows, err := s.Queries.ListUsers(ctx, sqlc.ListUsersParams{Search: search, SortBy: sortBy, Direction: orderBy, PageLimit: int32(limit), PageOffset: int32((page - 1) * limit)})
	if err != nil {
		return nil, model.Pagination{}, fault.DB(err)
	}
	out := make([]model.User, 0, len(rows))
	for _, r := range rows {
		value := projection.User(r)
		if err = s.enrich(ctx, &value); err != nil {
			return nil, model.Pagination{}, err
		}
		out = append(out, value)
	}
	pages := (int(total) + limit - 1) / limit
	return out, model.Pagination{Page: page, Limit: limit, TotalItems: int(total), TotalPages: pages, HasNextPage: page < pages, HasPrevPage: page > 1}, nil
}
func (s *Service) Create(ctx context.Context, p audit.Policy, actor *audit.Actor, b model.CreateUserBody) (model.User, error) {
	if err := fault.Email(b.Email); err != nil {
		return model.User{}, err
	}
	if err := fault.UUID(b.RoleID); err != nil {
		return model.User{}, err
	}
	if len(b.Password) < 6 || len(b.Password) > 72 {
		return model.User{}, fault.New(fault.Invalid, "Password must contain 6-72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), 12)
	if err != nil {
		return model.User{}, fault.DB(err)
	}
	out, err := audit.Mutate(ctx, s.Audit, p, actor, "CREATE", func(q *sqlc.Queries) (model.User, audit.Change, error) {
		row, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: b.Email, Password: string(hash), RoleID: b.RoleID})
		if err != nil {
			return model.User{}, audit.Change{}, fault.DB(err)
		}
		out := projection.User(row)
		change, err := audit.Capture(out.ID, (*model.User)(nil), &out)
		return out, change, err
	})
	if err != nil {
		return model.User{}, err
	}
	return s.Get(ctx, out.ID)
}
func (s *Service) Update(ctx context.Context, p audit.Policy, actor *audit.Actor, id string, b model.UpdateUserBody) (model.User, error) {
	if err := fault.UUID(id); err != nil {
		return model.User{}, err
	}
	if b.Email == nil && b.RoleID == nil {
		return model.User{}, fault.New(fault.Invalid, "No fields to update")
	}
	if b.Email != nil {
		if err := fault.Email(*b.Email); err != nil {
			return model.User{}, err
		}
	}
	if b.RoleID != nil {
		if err := fault.UUID(*b.RoleID); err != nil {
			return model.User{}, err
		}
	}
	_, err := audit.Mutate(ctx, s.Audit, p, actor, "UPDATE", func(q *sqlc.Queries) (model.User, audit.Change, error) {
		old, err := q.LockUser(ctx, id)
		if err != nil {
			return model.User{}, audit.Change{}, fault.DB(err)
		}
		var email pgtype.Text
		if b.Email != nil {
			email = pgtype.Text{String: *b.Email, Valid: true}
		}
		row, err := q.UpdateUser(ctx, sqlc.UpdateUserParams{ID: id, Email: email, RoleID: b.RoleID})
		if err != nil {
			return model.User{}, audit.Change{}, fault.DB(err)
		}
		before, out := projection.User(old), projection.User(row)
		change, err := audit.Capture(id, &before, &out)
		return out, change, err
	})
	if err != nil {
		return model.User{}, err
	}
	return s.Get(ctx, id)
}
func (s *Service) Delete(ctx context.Context, p audit.Policy, actor *audit.Actor, id string) error {
	if err := fault.UUID(id); err != nil {
		return err
	}
	if actor.ID == id {
		return fault.New(fault.Forbidden, "You cannot delete your own account.")
	}
	_, err := audit.Mutate(ctx, s.Audit, p, actor, "DELETE", func(q *sqlc.Queries) (struct{}, audit.Change, error) {
		current, err := q.LockUser(ctx, actor.ID)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		r, err := q.FindRole(ctx, current.RoleID)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		if r.Name != "admin" {
			return struct{}{}, audit.Change{}, fault.New(fault.Forbidden, "Only administrators are allowed to delete user accounts.")
		}
		row, err := q.LockUser(ctx, id)
		if err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		if err = q.SoftDeleteUser(ctx, id); err != nil {
			return struct{}{}, audit.Change{}, fault.DB(err)
		}
		before := projection.User(row)
		change, err := audit.Capture(id, &before, (*model.User)(nil))
		return struct{}{}, change, err
	})
	return err
}
