package db

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	mysqlsqlc "github.com/RidhuanDEV/golang-backend/internal/db/mysql/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connection is the application database port. Services never accept a driver transaction.
type Connection interface {
	Queries() sqlc.Querier
	Transaction(context.Context, func(sqlc.Querier) error) error
	Ping(context.Context) error
	Close()
}

type postgresConnection struct{ pool *pgxpool.Pool }

func WrapPostgreSQL(pool *pgxpool.Pool) Connection           { return &postgresConnection{pool} }
func (c *postgresConnection) Queries() sqlc.Querier          { return sqlc.New(c.pool) }
func (c *postgresConnection) Ping(ctx context.Context) error { return c.pool.Ping(ctx) }
func (c *postgresConnection) Close()                         { c.pool.Close() }
func (c *postgresConnection) Transaction(ctx context.Context, fn func(sqlc.Querier) error) error {
	return InTx(ctx, c.pool, func(tx pgx.Tx) error { return fn(sqlc.New(c.pool).WithTx(tx)) })
}

type mysqlConnection struct{ pool *sql.DB }

func (c *mysqlConnection) Queries() sqlc.Querier          { return &mysqlQueries{mysqlsqlc.New(c.pool)} }
func (c *mysqlConnection) Ping(ctx context.Context) error { return c.pool.PingContext(ctx) }
func (c *mysqlConnection) Close()                         { _ = c.pool.Close() }
func (c *mysqlConnection) Transaction(ctx context.Context, fn func(sqlc.Querier) error) error {
	tx, err := c.pool.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err = fn(&mysqlQueries{mysqlsqlc.New(tx)}); err != nil {
		return err
	}
	return tx.Commit()
}

func MySQLConfig(raw string) (*mysql.Config, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "mysql" || parsed.Hostname() == "" || parsed.User == nil {
		return nil, errors.New("MySQL DATABASE_URL requires mysql:// credentials/host/database")
	}
	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" || strings.Contains(database, "/") {
		return nil, errors.New("invalid MySQL database name")
	}
	port := parsed.Port()
	if port == "" {
		port = "3306"
	}
	config := mysql.NewConfig()
	config.User = parsed.User.Username()
	config.Passwd, _ = parsed.User.Password()
	config.Net = "tcp"
	config.Addr = net.JoinHostPort(parsed.Hostname(), port)
	config.DBName = database
	config.ParseTime = true
	config.Loc = time.UTC
	config.Timeout = 3 * time.Second
	config.ReadTimeout = 10 * time.Second
	config.WriteTimeout = 10 * time.Second
	config.Collation = "utf8mb4_bin"
	config.Params = map[string]string{"time_zone": "'+00:00'"}
	switch parsed.Query().Get("sslmode") {
	case "", "disable":
		if parsed.Query().Has("sslrootcert") {
			return nil, errors.New("sslrootcert requires sslmode=verify-full")
		}
	case "verify-full":
		config.TLSConfig = "true"
		config.TLS = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: parsed.Hostname()}
		if certificate := parsed.Query().Get("sslrootcert"); certificate != "" {
			pem, readErr := os.ReadFile(certificate)
			if readErr != nil {
				return nil, errors.New("cannot read MySQL CA certificate")
			}
			roots, rootsErr := x509.SystemCertPool()
			if rootsErr != nil || roots == nil {
				roots = x509.NewCertPool()
			}
			if !roots.AppendCertsFromPEM(pem) {
				return nil, errors.New("MySQL CA file contains no certificates")
			}
			config.TLS.RootCAs = roots
		}
	default:
		return nil, errors.New("MySQL sslmode must be disable or verify-full")
	}
	return config, nil
}

func ConnectProvider(ctx context.Context, provider, raw string) (Connection, error) {
	if provider == "" || provider == "postgresql" {
		pool, err := Connect(ctx, raw)
		if err != nil {
			return nil, err
		}
		return WrapPostgreSQL(pool), nil
	}
	if provider != "mysql" {
		return nil, errors.New("DB_PROVIDER must be postgresql or mysql")
	}
	config, err := MySQLConfig(raw)
	if err != nil {
		return nil, err
	}
	connector, err := mysql.NewConnector(config)
	if err != nil {
		return nil, err
	}
	pool := sql.OpenDB(connector)
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(5 * time.Minute)
	if err = pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, err
	}
	return &mysqlConnection{pool}, nil
}
