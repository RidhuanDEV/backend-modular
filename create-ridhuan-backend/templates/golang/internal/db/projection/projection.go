package projection

import (
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/model"
)

func User(r sqlc.User) model.User {
	return model.User{ID: r.ID, Email: r.Email, RoleID: r.RoleID, CreatedAt: r.CreatedAt.Time.UTC(), UpdatedAt: r.UpdatedAt.Time.UTC()}
}
func AuthUser(r sqlc.User) model.AuthUser {
	out := model.AuthUser{ID: r.ID, Email: r.Email, RoleID: r.RoleID, CreatedAt: r.CreatedAt.Time.UTC(), UpdatedAt: r.UpdatedAt.Time.UTC()}
	if r.DeletedAt.Valid {
		t := r.DeletedAt.Time.UTC()
		out.DeletedAt = &t
	}
	return out
}
func Role(r sqlc.Role) model.Role {
	return model.Role{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.Time.UTC(), UpdatedAt: r.UpdatedAt.Time.UTC(), Permissions: []model.RolePermission{}}
}
func Permission(r sqlc.Permission) model.Permission {
	return model.Permission{ID: r.ID, Name: r.Name, CreatedAt: r.CreatedAt.Time.UTC(), UpdatedAt: r.UpdatedAt.Time.UTC()}
}
func File(r sqlc.StoredFile) model.StoredFile {
	return model.StoredFile{ID: r.ID, OriginalName: r.OriginalName, MIMEType: r.MimeType, Size: r.Size, CreatedAt: r.CreatedAt.Time.UTC()}
}
