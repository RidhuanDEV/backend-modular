package app

import (
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/auth"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/permission"
	"github.com/RidhuanDEV/golang-backend/internal/role"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/RidhuanDEV/golang-backend/internal/upload"
	"github.com/RidhuanDEV/golang-backend/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
)

type Services struct {
	Auth        *auth.Service
	Users       *user.Service
	Roles       *role.Service
	Permissions *permission.Service
	Uploads     *upload.Service
	Audit       *audit.Writer
}

func New(c config.Config, pool *pgxpool.Pool, store storage.Storage, logger *slog.Logger) Services {
	q := sqlc.New(pool)
	a := &audit.Writer{Pool: pool, Log: logger}
	r := &role.Service{Queries: q, Audit: a}
	return Services{Auth: &auth.Service{Queries: q, Audit: a, Secret: []byte(c.JWTSecret), Issuer: c.JWTIssuer, Audience: c.JWTAudience}, Users: &user.Service{Queries: q, Audit: a, Roles: r}, Roles: r, Permissions: &permission.Service{Queries: q, Audit: a}, Uploads: &upload.Service{Queries: q, Audit: a, Storage: store, Kind: c.UploadStorage, Log: logger}, Audit: a}
}
