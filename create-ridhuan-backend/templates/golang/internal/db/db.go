package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/db/migrations"
	mysqlmigrations "github.com/RidhuanDEV/golang-backend/internal/db/mysql/migrations"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	config.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func Migrate(url string) error {
	return MigrateProvider("postgresql", url, 0)
}

func MigrateTo(url string, version int64) error { return MigrateProvider("postgresql", url, version) }

func MigrateProvider(provider, url string, version int64) error {
	dialect := "postgres"
	driver := "pgx"
	if provider == "mysql" {
		config, err := MySQLConfig(url)
		if err != nil {
			return err
		}
		connector, err := mysql.NewConnector(config)
		if err != nil {
			return err
		}
		database := sql.OpenDB(connector)
		defer database.Close()
		if err = goose.SetDialect("mysql"); err != nil {
			return err
		}
		goose.SetBaseFS(mysqlmigrations.FS)
		if version > 0 {
			return goose.UpTo(database, ".", version)
		}
		return goose.Up(database, ".")
	}
	if provider != "" && provider != "postgresql" {
		return fmt.Errorf("invalid DB_PROVIDER")
	}
	if !strings.Contains(url, "timezone=") {
		separator := "?"
		if strings.Contains(url, "?") {
			separator = "&"
		}
		url += separator + "timezone=UTC"
	}
	database, err := sql.Open(driver, url)
	if err != nil {
		return err
	}
	defer database.Close()
	if err = goose.SetDialect(dialect); err != nil {
		return err
	}
	goose.SetBaseFS(migrations.FS)
	if version > 0 {
		err = goose.UpTo(database, ".", version)
	} else {
		err = goose.Up(database, ".")
	}
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
