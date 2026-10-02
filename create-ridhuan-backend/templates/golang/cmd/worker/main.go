package main

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/jobs"
	"github.com/RidhuanDEV/golang-backend/internal/notification"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped")
		os.Exit(1)
	}
}
func run() error {
	if err := config.LoadEnvironment(".env"); err != nil {
		return err
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if !c.SMTPEnabled {
		log.Info("SMTP disabled; worker is idle until shutdown")
		<-ctx.Done()
		return nil
	}
	stop, err := telemetry.Setup(ctx, c)
	if err != nil {
		return err
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = stop(shutdown)
	}()
	pool, err := db.ConnectProvider(ctx, c.DatabaseProvider, c.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	sender := notification.Service{SMTP: c}
	worker := jobs.Worker{Pool: pool, Config: c.Operations, Log: log, Send: func(ctx context.Context, p jobs.Payload) error { return sender.Send(ctx, p.Recipient, p.Title, p.Body) }}
	worker.Run(ctx)
	return nil
}
