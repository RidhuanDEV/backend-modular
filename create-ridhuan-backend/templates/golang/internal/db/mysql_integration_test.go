package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestMySQLUpgradeUTCAndTransactionRollback(t *testing.T) {
	raw := os.Getenv("MYSQL_TEST_ADMIN_URL")
	if raw == "" {
		t.Skip("MYSQL_TEST_ADMIN_URL requires a disposable MySQL server with CREATE DATABASE permission")
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	config, err := MySQLConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	connector, err := mysql.NewConnector(config)
	if err != nil {
		t.Fatal(err)
	}
	admin := sql.OpenDB(connector)
	defer admin.Close()
	name := "mysql_upgrade_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.ExecContext(ctx, "CREATE DATABASE `"+name+"` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, cleanupErr := admin.ExecContext(cleanup, "DROP DATABASE `"+name+"`"); cleanupErr != nil {
			t.Error(cleanupErr)
		}
	}()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	if err = MigrateProvider("mysql", parsed.String(), 1); err != nil {
		t.Fatal(err)
	}
	connection, err := ConnectProvider(ctx, "mysql", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	queries := connection.Queries()
	if err = queries.SeedRole(ctx, "legacy-fixture"); err != nil {
		t.Fatal(err)
	}
	before, err := queries.FindRoleByName(ctx, "legacy-fixture")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = MigrateProvider("mysql", parsed.String(), 0); err != nil {
			t.Fatal(err)
		}
	}
	after, err := queries.FindRoleByName(ctx, "legacy-fixture")
	if err != nil || before.ID != after.ID || !before.CreatedAt.Time.Equal(after.CreatedAt.Time) {
		t.Fatal("upgrade lost role identity or timestamp", err)
	}
	if after.CreatedAt.Time.Location() != time.UTC {
		t.Fatal("database timestamp is not UTC")
	}
	abort := errors.New("synthetic audit failure")
	err = connection.Transaction(ctx, func(transaction sqlc.Querier) error {
		if _, createErr := transaction.CreateRole(ctx, "must-rollback"); createErr != nil {
			return createErr
		}
		return abort
	})
	if !errors.Is(err, abort) {
		t.Fatal("transaction did not return failure", err)
	}
	if _, err = queries.FindRoleByName(ctx, "must-rollback"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("failed transaction persisted mutation", err)
	}
	// The lockout guard queries and session revocation run through the MySQL adapter.
	if err = queries.SeedRole(ctx, "root-fixture"); err != nil {
		t.Fatal(err)
	}
	root, err := queries.FindRoleByName(ctx, "root-fixture")
	if err != nil {
		t.Fatal(err)
	}
	user, err := queries.CreateUser(ctx, sqlc.CreateUserParams{Lower: "root-fixture@example.test", Password: "unused", RoleID: root.ID})
	if err != nil {
		t.Fatal(err)
	}
	family := uuid.NewString()
	if err = queries.CreateRefreshFamily(ctx, sqlc.CreateRefreshFamilyParams{ID: family, UserID: user.ID, ExpiresAt: sql.NullTime{Time: time.Now().UTC().Add(time.Hour), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	err = connection.Transaction(ctx, func(transaction sqlc.Querier) error {
		if _, lockErr := transaction.LockPermissionByName(ctx, "manage_users"); lockErr != nil {
			return lockErr
		}
		if _, countErr := transaction.CountActivePermissionHolders(ctx, "manage_users"); countErr != nil {
			return countErr
		}
		roles, listErr := transaction.ListRoleIDsWithPermissionName(ctx, "manage_permissions")
		if listErr != nil {
			return listErr
		}
		if slices.Contains(roles, root.ID) {
			return fmt.Errorf("fixture role unexpectedly manages permissions")
		}
		if revokeErr := transaction.RevokeUserRefreshFamilies(ctx, user.ID); revokeErr != nil {
			return revokeErr
		}
		return transaction.RevokeUserAuthRefreshTokens(ctx, user.ID)
	})
	if err != nil {
		t.Fatal(err)
	}
	revoked, err := queries.LockRefreshFamily(ctx, family)
	if err != nil || !revoked.RevokedAt.Valid {
		t.Fatal("refresh family was not revoked", err)
	}
}
