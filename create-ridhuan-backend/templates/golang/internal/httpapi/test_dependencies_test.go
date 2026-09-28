package httpapi

import (
	"github.com/RidhuanDEV/golang-backend/internal/app"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"io"
	"log/slog"
)

// Nil pools are deliberate in transport-only tests: authenticated business paths
// are exercised separately against a real PostgreSQL database.
func newTestServer(c config.Config, pool *pgxpool.Pool, client *redis.Client, store storage.Storage, logger *slog.Logger) (*Server, error) {
	return NewServer(c, pool, client, app.New(c, pool, store, logger), logger)
}
func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }
