package db

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestFreshDatabaseUpgradePreservesExistingData(t *testing.T) {
	connection := os.Getenv("DATABASE_URL")
	if connection == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	admin, err := Connect(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "refine_upgrade_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE DATABASE "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, e := admin.Exec(cleanup, "DROP DATABASE "+identifier+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	parsed, err := url.Parse(connection)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	if err = MigrateTo(parsed.String(), 1); err != nil {
		t.Fatal(err)
	}
	pool, err := Connect(ctx, parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	queries := sqlc.New(pool)
	if err = queries.SeedRole(ctx, "upgrade-fixture"); err != nil {
		t.Fatal(err)
	}
	before, err := queries.FindRoleByName(ctx, "upgrade-fixture")
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(parsed.String()); err != nil {
		t.Fatal(err)
	}
	after, err := queries.FindRoleByName(ctx, "upgrade-fixture")
	if err != nil || before.ID != after.ID || before.Name != after.Name || !before.CreatedAt.Time.Equal(after.CreatedAt.Time) {
		t.Fatal("upgrade changed fixture", err)
	}
	var version int64
	if err = pool.QueryRow(ctx, "SELECT max(version_id) FROM goose_db_version WHERE is_applied").Scan(&version); err != nil || version != 3 {
		t.Fatal("upgrade did not reach latest migration", version, err)
	}
}
