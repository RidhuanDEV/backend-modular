package jobs

import (
	"context"
	"database/sql"
	"errors"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"github.com/google/uuid"
	"log/slog"
	"sync"
	"time"
)

type Payload struct{ Recipient, Title, Body string }
type Sender func(context.Context, Payload) error

func instant(value time.Time) sql.NullTime { return sql.NullTime{Time: value.UTC(), Valid: true} }

var retries = []time.Duration{5 * time.Second, 30 * time.Second, 120 * time.Second, 600 * time.Second}

type Worker struct {
	Pool   db.Connection
	Config config.Operations
	Send   Sender
	Log    *slog.Logger
}

func (w *Worker) claim(ctx context.Context) (*sqlc.EmailJob, error) {
	var out *sqlc.EmailJob
	err := w.Pool.Transaction(ctx, func(q sqlc.Querier) error {
		now := time.Now().UTC()
		job, err := q.ClaimableEmail(ctx, instant(now))
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if int(job.Attempts) >= w.Config.MaxAttempts {
			if err = q.CompleteEmail(ctx, sqlc.CompleteEmailParams{ID: job.ID, Status: "FAILED", AvailableAt: job.AvailableAt, CompletedAt: instant(now)}); err != nil {
				return err
			}
			return q.SetNotificationEmailStatus(ctx, sqlc.SetNotificationEmailStatusParams{ID: job.NotificationID, EmailStatus: "FAILED"})
		}
		lease := uuid.NewString()
		if err = q.ClaimEmail(ctx, sqlc.ClaimEmailParams{ID: job.ID, LeaseID: &lease, LeaseUntil: instant(now.Add(time.Duration(w.Config.LeaseSeconds) * time.Second))}); err != nil {
			return err
		}
		claimed, err := q.LockEmail(ctx, job.ID)
		if err != nil {
			return err
		}
		out = &claimed
		return nil
	})
	return out, err
}
func (w *Worker) deliver(ctx context.Context, job sqlc.EmailJob) error {
	ctx, span := telemetry.Start(ctx, "email")
	defer span.End()
	// Finish an in-flight delivery on shutdown. SMTP is bounded; recovery remains lease based.
	delivery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 25*time.Second)
	defer cancel()
	renewCtx, stopRenew := context.WithCancel(delivery)
	renewed := make(chan bool, 1)
	go func() {
		ticker := time.NewTicker(time.Duration(w.Config.RenewSeconds) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				renewed <- true
				return
			case <-ticker.C:
				count, err := w.Pool.Queries().RenewEmail(renewCtx, sqlc.RenewEmailParams{ID: job.ID, LeaseID: job.LeaseID, LeaseUntil: instant(time.Now().Add(time.Duration(w.Config.LeaseSeconds) * time.Second))})
				if err != nil && renewCtx.Err() != nil {
					renewed <- true
					return
				}
				if err != nil || count != 1 {
					renewed <- false
					return
				}
			}
		}
	}()
	success := w.Send(delivery, Payload{job.Recipient, job.Title, job.Body}) == nil
	stopRenew()
	if !<-renewed {
		return nil
	}
	finish, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	outcome := ""
	err := w.Pool.Transaction(finish, func(q sqlc.Querier) error {
		current, err := q.LockEmail(finish, job.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		if current.Status != "PROCESSING" || current.LeaseID == nil || job.LeaseID == nil || *current.LeaseID != *job.LeaseID || !current.LeaseUntil.Time.After(now) {
			return nil
		}
		terminal := success || int(job.Attempts) >= w.Config.MaxAttempts
		status := "PENDING"
		completed := sql.NullTime{}
		available := now
		if terminal {
			status = "FAILED"
			if success {
				status = "SENT"
			}
			completed = instant(now)
		} else {
			index := int(job.Attempts) - 1
			if index < 0 {
				index = 0
			}
			if index >= len(retries) {
				index = len(retries) - 1
			}
			available = now.Add(retries[index])
		}
		if err = q.CompleteEmail(finish, sqlc.CompleteEmailParams{ID: job.ID, Status: status, AvailableAt: instant(available), CompletedAt: completed}); err != nil {
			return err
		}
		outcome = status
		if status == "PENDING" {
			outcome = "RETRY"
		}
		if terminal {
			return q.SetNotificationEmailStatus(finish, sqlc.SetNotificationEmailStatusParams{ID: job.NotificationID, EmailStatus: status})
		}
		return nil
	})
	if err == nil && outcome != "" {
		telemetry.Email(finish, outcome)
	}
	return err
}
func (w *Worker) Run(ctx context.Context) {
	var group sync.WaitGroup
	for i := 0; i < w.Config.Concurrency; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for ctx.Err() == nil {
				count, countErr := w.Pool.Queries().EmailBacklogCount(ctx)
				oldest, ageErr := w.Pool.Queries().EmailBacklogOldest(ctx)
				if countErr == nil && ageErr == nil {
					age := 0.0
					if oldest.Valid {
						age = time.Since(oldest.Time).Seconds()
					}
					telemetry.Outbox(ctx, count, age)
				}
				job, err := w.claim(ctx)
				if err != nil {
					w.Log.Warn("email persistence unavailable")
				} else if job != nil {
					if err = w.deliver(ctx, *job); err != nil {
						w.Log.Warn("email completion failed", "jobId", job.ID)
					}
					continue
				}
				timer := time.NewTimer(time.Duration(w.Config.PollSeconds) * time.Second)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
		}()
	}
	group.Wait()
}
