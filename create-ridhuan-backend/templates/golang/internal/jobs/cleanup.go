package jobs

import (
	"context"
	"fmt"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"time"
)

func Cleanup(ctx context.Context, pool db.Connection, c config.Operations, apply bool) error {
	ctx, span := telemetry.Start(ctx, "cleanup")
	defer span.End()
	var familyCount, emailCount, logCount int64
	now := time.Now().UTC()
	err := pool.Transaction(ctx, func(q sqlc.Querier) error {
		families, err := q.CleanupFamilies(ctx, sqlc.CleanupFamiliesParams{Cutoff: instant(now.Add(-time.Duration(c.SessionDays) * 24 * time.Hour)), BatchSize: int32(c.BatchSize)})
		if err != nil {
			return err
		}
		emails, err := q.CleanupEmail(ctx, sqlc.CleanupEmailParams{Cutoff: instant(now.Add(-time.Duration(c.OutboxDays) * 24 * time.Hour)), BatchSize: int32(c.BatchSize)})
		if err != nil {
			return err
		}
		var logs []string
		if c.AuditEnabled {
			logs, err = q.CleanupAudit(ctx, sqlc.CleanupAuditParams{Cutoff: instant(now.Add(-time.Duration(c.AuditDays) * 24 * time.Hour)), BatchSize: int32(c.BatchSize)})
			if err != nil {
				return err
			}
		}
		if apply {
			for _, id := range families {
				if err = q.DeleteFamily(ctx, id); err != nil {
					return err
				}
			}
			for _, id := range emails {
				if err = q.DeleteEmail(ctx, id); err != nil {
					return err
				}
			}
			for _, id := range logs {
				if err = q.DeleteAudit(ctx, id); err != nil {
					return err
				}
			}
		}
		familyCount, emailCount, logCount = int64(len(families)), int64(len(emails)), int64(len(logs))
		fmt.Printf("apply=%t families=%d outbox=%d audit=%d\n", apply, len(families), len(emails), len(logs))
		return nil
	})
	if err == nil {
		telemetry.Cleanup(ctx, "family", familyCount, apply)
		telemetry.Cleanup(ctx, "outbox", emailCount, apply)
		telemetry.Cleanup(ctx, "audit", logCount, apply)
	}
	return err
}
