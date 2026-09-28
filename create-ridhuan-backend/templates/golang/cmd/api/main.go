package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/app"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/httpapi"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api failed", "error", err)
		os.Exit(1)
	}
}
func run() error {
	_ = godotenv.Load()
	c, err := config.Load()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	initCtx, stopInit := context.WithTimeout(ctx, 10*time.Second)
	defer stopInit()
	otelShutdown, err := telemetry.Setup(initCtx, c)
	if err != nil {
		return fmt.Errorf("OpenTelemetry setup: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := otelShutdown(shutdownCtx); err != nil {
			logger.Warn("OpenTelemetry shutdown failed", "error", err)
		}
	}()
	pool, err := db.Connect(initCtx, c.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database connection: %w", err)
	}
	defer pool.Close()
	var redisClient *redis.Client
	if c.CacheEnabled || c.RateStore == "redis" {
		options, err := redis.ParseURL(c.RedisURL)
		if err != nil {
			return err
		}
		redisClient = redis.NewClient(options)
		defer redisClient.Close()
		if c.RateStore == "redis" {
			if err = redisClient.Ping(initCtx).Err(); err != nil {
				return fmt.Errorf("Redis rate store: %w", err)
			}
		}
	}
	var fileStore storage.Storage
	if c.UploadEnabled {
		if c.UploadStorage == "s3" {
			fileStore, err = storage.NewS3(initCtx, c)
		} else {
			fileStore, err = storage.NewLocal(c.UploadLocalDir)
		}
		if err != nil {
			return err
		}
	}
	server, err := httpapi.NewServer(c, pool, redisClient, app.New(c, pool, fileStore, logger), logger)
	if err != nil {
		return err
	}
	var handler http.Handler = server.Router
	if c.OTelEnabled {
		handler = otelhttp.NewHandler(handler, "http.server")
	}
	httpServer := &http.Server{Addr: fmt.Sprintf(":%d", c.Port), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	logger.Info("HTTP server listening", "port", c.Port)
	return serve(ctx, httpServer, httpServer.ListenAndServe)
}

// Wait for active requests before run closes the database and storage dependencies.
func serve(ctx context.Context, server *http.Server, listen func() error) error {
	finished := make(chan error, 1)
	go func() { finished <- listen() }()
	select {
	case err := <-finished:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err := server.Shutdown(shutdownCtx)
		if err != nil {
			_ = server.Close()
		}
		listenErr := <-finished
		if err != nil {
			return fmt.Errorf("HTTP shutdown: %w", err)
		}
		if !errors.Is(listenErr, http.ErrServerClosed) {
			return listenErr
		}
		return nil
	}
}
