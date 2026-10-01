package db

import (
	"context"
	"database/sql"
	mysqlsqlc "github.com/RidhuanDEV/golang-backend/internal/db/mysql/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/google/uuid"
)

type mysqlQueries struct{ q *mysqlsqlc.Queries }

var _ sqlc.Querier = (*mysqlQueries)(nil)

func (m *mysqlQueries) CreateRole(ctx context.Context, name string) (sqlc.Role, error) {
	id := uuid.NewString()
	if err := m.q.CreateRole(ctx, mysqlsqlc.CreateRoleParams{ID: id, Name: name}); err != nil {
		return sqlc.Role{}, err
	}
	return m.FindRole(ctx, id)
}
func (m *mysqlQueries) CreatePermission(ctx context.Context, name string) (sqlc.Permission, error) {
	id := uuid.NewString()
	if err := m.q.CreatePermission(ctx, mysqlsqlc.CreatePermissionParams{ID: id, Name: name}); err != nil {
		return sqlc.Permission{}, err
	}
	return m.FindPermission(ctx, id)
}
func (m *mysqlQueries) CreateUser(ctx context.Context, arg sqlc.CreateUserParams) (sqlc.User, error) {
	id := uuid.NewString()
	if err := m.q.CreateUser(ctx, mysqlsqlc.CreateUserParams{ID: id, Email: arg.Lower, Password: arg.Password, RoleID: arg.RoleID}); err != nil {
		return sqlc.User{}, err
	}
	return m.FindUser(ctx, id)
}
func (m *mysqlQueries) CreateFile(ctx context.Context, arg sqlc.CreateFileParams) (sqlc.StoredFile, error) {
	id := uuid.NewString()
	if err := m.q.CreateFile(ctx, mysqlsqlc.CreateFileParams{ID: id, Storage: arg.Storage, ObjectKey: arg.ObjectKey, OriginalName: arg.OriginalName, MimeType: arg.MimeType, Size: arg.Size, UploaderID: arg.UploaderID}); err != nil {
		return sqlc.StoredFile{}, err
	}
	return m.FindFile(ctx, id)
}
func (m *mysqlQueries) UpdateRole(ctx context.Context, arg sqlc.UpdateRoleParams) (sqlc.Role, error) {
	if err := m.q.UpdateRole(ctx, mysqlsqlc.UpdateRoleParams{ID: arg.ID, Name: arg.Name}); err != nil {
		return sqlc.Role{}, err
	}
	return m.FindRole(ctx, arg.ID)
}
func (m *mysqlQueries) UpdatePermission(ctx context.Context, arg sqlc.UpdatePermissionParams) (sqlc.Permission, error) {
	if err := m.q.UpdatePermission(ctx, mysqlsqlc.UpdatePermissionParams{ID: arg.ID, Name: arg.Name}); err != nil {
		return sqlc.Permission{}, err
	}
	return m.FindPermission(ctx, arg.ID)
}
func (m *mysqlQueries) UpdateUser(ctx context.Context, arg sqlc.UpdateUserParams) (sqlc.User, error) {
	var role sql.NullString
	if arg.RoleID != nil {
		role = sql.NullString{String: *arg.RoleID, Valid: true}
	}
	if err := m.q.UpdateUser(ctx, mysqlsqlc.UpdateUserParams{ID: arg.ID, Email: arg.Email, RoleID: role}); err != nil {
		return sqlc.User{}, err
	}
	return m.FindUser(ctx, arg.ID)
}
func (m *mysqlQueries) CountUsers(ctx context.Context, search string) (int64, error) {
	return m.q.CountUsers(ctx, mysqlsqlc.CountUsersParams{Search: search})
}
func (m *mysqlQueries) SeedUser(ctx context.Context, arg sqlc.SeedUserParams) error {
	return m.q.SeedUser(ctx, mysqlsqlc.SeedUserParams{Email: arg.Lower, Password: arg.Password, Name: arg.Name})
}
func (m *mysqlQueries) ListUsers(ctx context.Context, arg sqlc.ListUsersParams) ([]sqlc.User, error) {
	var key int64 = 2
	switch arg.SortBy {
	case "email":
		key = 1
	case "updatedAt":
		key = 3
	}
	var descending int64
	if arg.Direction == "desc" {
		descending = 1
	}
	rows, err := m.q.ListUsers(ctx, mysqlsqlc.ListUsersParams{Search: arg.Search, SortKey: key, Descending: descending, Limit: arg.PageLimit, Offset: arg.PageOffset})
	result := make([]sqlc.User, 0, len(rows))
	for _, row := range rows {
		result = append(result, sqlc.User(row))
	}
	return result, err
}
func (m *mysqlQueries) ListOwnNotifications(ctx context.Context, arg sqlc.ListOwnNotificationsParams) ([]sqlc.Notification, error) {
	var unread int64
	if arg.Unread {
		unread = 1
	}
	rows, err := m.q.ListOwnNotifications(ctx, mysqlsqlc.ListOwnNotificationsParams{RecipientID: arg.RecipientID, Unread: unread})
	result := make([]sqlc.Notification, 0, len(rows))
	for _, row := range rows {
		result = append(result, sqlc.Notification(row))
	}
	return result, err
}

func (m *mysqlQueries) AssignRolePermission(ctx context.Context, arg sqlc.AssignRolePermissionParams) error {
	return m.q.AssignRolePermission(ctx, mysqlsqlc.AssignRolePermissionParams{RoleID: arg.RoleID, PermissionID: arg.PermissionID})
}

func (m *mysqlQueries) ClearRolePermissions(ctx context.Context, roleID string) error {
	return m.q.ClearRolePermissions(ctx, roleID)
}

func (m *mysqlQueries) CreateAuthRefreshToken(ctx context.Context, arg sqlc.CreateAuthRefreshTokenParams) error {
	return m.q.CreateAuthRefreshToken(ctx, mysqlsqlc.CreateAuthRefreshTokenParams{FamilyID: arg.FamilyID, UserID: arg.UserID, TokenHash: arg.TokenHash, ExpiresAt: arg.ExpiresAt})
}

func (m *mysqlQueries) CreateNotification(ctx context.Context, arg sqlc.CreateNotificationParams) error {
	return m.q.CreateNotification(ctx, mysqlsqlc.CreateNotificationParams{ID: arg.ID, RecipientID: arg.RecipientID, ActorID: arg.ActorID, Title: arg.Title, Body: arg.Body, EmailStatus: arg.EmailStatus})
}

func (m *mysqlQueries) DeleteExpiredAuthRefreshTokens(ctx context.Context, userID string) error {
	return m.q.DeleteExpiredAuthRefreshTokens(ctx, userID)
}

func (m *mysqlQueries) DeletePermission(ctx context.Context, id string) error {
	return m.q.DeletePermission(ctx, id)
}

func (m *mysqlQueries) DeleteRole(ctx context.Context, id string) error {
	return m.q.DeleteRole(ctx, id)
}

func (m *mysqlQueries) FileReferenced(ctx context.Context, arg sqlc.FileReferencedParams) (bool, error) {
	return m.q.FileReferenced(ctx, mysqlsqlc.FileReferencedParams{ObjectKey: arg.ObjectKey, Storage: arg.Storage})
}

func (m *mysqlQueries) FindActiveUserByEmail(ctx context.Context, email string) (sqlc.User, error) {
	row, err := m.q.FindActiveUserByEmail(ctx, email)
	return sqlc.User(row), err
}

func (m *mysqlQueries) FindActiveUserByID(ctx context.Context, id string) (sqlc.User, error) {
	row, err := m.q.FindActiveUserByID(ctx, id)
	return sqlc.User(row), err
}

func (m *mysqlQueries) FindAuthRefreshTokenByHash(ctx context.Context, tokenHash []byte) (sqlc.AuthRefreshToken, error) {
	row, err := m.q.FindAuthRefreshTokenByHash(ctx, tokenHash)
	return sqlc.AuthRefreshToken(row), err
}

func (m *mysqlQueries) FindFile(ctx context.Context, id string) (sqlc.StoredFile, error) {
	row, err := m.q.FindFile(ctx, id)
	return sqlc.StoredFile(row), err
}

func (m *mysqlQueries) FindNotification(ctx context.Context, id string) (sqlc.Notification, error) {
	row, err := m.q.FindNotification(ctx, id)
	return sqlc.Notification(row), err
}

func (m *mysqlQueries) FindPermission(ctx context.Context, id string) (sqlc.Permission, error) {
	row, err := m.q.FindPermission(ctx, id)
	return sqlc.Permission(row), err
}

func (m *mysqlQueries) FindRole(ctx context.Context, id string) (sqlc.Role, error) {
	row, err := m.q.FindRole(ctx, id)
	return sqlc.Role(row), err
}

func (m *mysqlQueries) FindRoleByName(ctx context.Context, name string) (sqlc.Role, error) {
	row, err := m.q.FindRoleByName(ctx, name)
	return sqlc.Role(row), err
}

func (m *mysqlQueries) FindUser(ctx context.Context, id string) (sqlc.User, error) {
	row, err := m.q.FindUser(ctx, id)
	return sqlc.User(row), err
}

func (m *mysqlQueries) InsertAudit(ctx context.Context, arg sqlc.InsertAuditParams) error {
	return m.q.InsertAudit(ctx, mysqlsqlc.InsertAuditParams{Behavior: arg.Behavior, Module: arg.Module, EntityID: arg.EntityID, UserID: arg.UserID, ActorIDSnapshot: arg.ActorIDSnapshot, Before: arg.Before, After: arg.After, RequestID: arg.RequestID, EndpointID: arg.EndpointID})
}

func (m *mysqlQueries) ListPermissions(ctx context.Context) ([]sqlc.Permission, error) {
	rows, err := m.q.ListPermissions(ctx)
	result := make([]sqlc.Permission, 0, len(rows))
	for _, row := range rows {
		result = append(result, sqlc.Permission(row))
	}
	return result, err
}

func (m *mysqlQueries) ListRolePermissionIDs(ctx context.Context, roleID string) ([]string, error) {
	return m.q.ListRolePermissionIDs(ctx, roleID)
}

func (m *mysqlQueries) ListRolePermissions(ctx context.Context, roleID string) ([]sqlc.ListRolePermissionsRow, error) {
	rows, err := m.q.ListRolePermissions(ctx, roleID)
	result := make([]sqlc.ListRolePermissionsRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, sqlc.ListRolePermissionsRow(row))
	}
	return result, err
}

func (m *mysqlQueries) ListRoles(ctx context.Context) ([]sqlc.Role, error) {
	rows, err := m.q.ListRoles(ctx)
	result := make([]sqlc.Role, 0, len(rows))
	for _, row := range rows {
		result = append(result, sqlc.Role(row))
	}
	return result, err
}

func (m *mysqlQueries) LockOwnNotification(ctx context.Context, arg sqlc.LockOwnNotificationParams) (sqlc.Notification, error) {
	row, err := m.q.LockOwnNotification(ctx, mysqlsqlc.LockOwnNotificationParams{ID: arg.ID, RecipientID: arg.RecipientID})
	return sqlc.Notification(row), err
}

func (m *mysqlQueries) LockPermission(ctx context.Context, id string) (sqlc.Permission, error) {
	row, err := m.q.LockPermission(ctx, id)
	return sqlc.Permission(row), err
}

func (m *mysqlQueries) LockRole(ctx context.Context, id string) (sqlc.Role, error) {
	row, err := m.q.LockRole(ctx, id)
	return sqlc.Role(row), err
}

func (m *mysqlQueries) LockUser(ctx context.Context, id string) (sqlc.User, error) {
	row, err := m.q.LockUser(ctx, id)
	return sqlc.User(row), err
}

func (m *mysqlQueries) ReadNotification(ctx context.Context, id string) error {
	return m.q.ReadNotification(ctx, id)
}

func (m *mysqlQueries) RevokeAuthRefreshFamily(ctx context.Context, familyID string) error {
	return m.q.RevokeAuthRefreshFamily(ctx, familyID)
}

func (m *mysqlQueries) RevokeAuthRefreshToken(ctx context.Context, id string) (int64, error) {
	return m.q.RevokeAuthRefreshToken(ctx, id)
}

func (m *mysqlQueries) SeedAdminPermissions(ctx context.Context) error {
	return m.q.SeedAdminPermissions(ctx)
}

func (m *mysqlQueries) SeedPermission(ctx context.Context, name string) error {
	return m.q.SeedPermission(ctx, name)
}

func (m *mysqlQueries) SeedRole(ctx context.Context, name string) error {
	return m.q.SeedRole(ctx, name)
}

func (m *mysqlQueries) SetNotificationEmailStatus(ctx context.Context, arg sqlc.SetNotificationEmailStatusParams) error {
	return m.q.SetNotificationEmailStatus(ctx, mysqlsqlc.SetNotificationEmailStatusParams{EmailStatus: arg.EmailStatus, ID: arg.ID})
}

func (m *mysqlQueries) SoftDeleteUser(ctx context.Context, id string) error {
	return m.q.SoftDeleteUser(ctx, id)
}

func (m *mysqlQueries) UserHasPermission(ctx context.Context, arg sqlc.UserHasPermissionParams) (bool, error) {
	return m.q.UserHasPermission(ctx, mysqlsqlc.UserHasPermissionParams{ID: arg.ID, Name: arg.Name})
}
