package config

import (
	"fmt"
	"os"
)

type Operations struct {
	Concurrency, PollSeconds, LeaseSeconds, RenewSeconds, MaxAttempts int
	BatchSize, SessionDays, OutboxDays, AuditDays                     int
	AuditEnabled                                                      bool
}

func loadOperations() (Operations, error) {
	c := Operations{}
	fields := []struct {
		key                string
		value              *int
		fallback, min, max int
	}{
		{"WORKER_CONCURRENCY", &c.Concurrency, 2, 1, 16}, {"WORKER_POLL_SECONDS", &c.PollSeconds, 3, 1, 300},
		{"WORKER_LEASE_SECONDS", &c.LeaseSeconds, 60, 30, 3600}, {"WORKER_RENEW_SECONDS", &c.RenewSeconds, 20, 1, 1800},
		{"WORKER_MAX_ATTEMPTS", &c.MaxAttempts, 5, 1, 5}, {"CLEANUP_BATCH_SIZE", &c.BatchSize, 500, 1, 5000},
		{"CLEANUP_SESSION_DAYS", &c.SessionDays, 30, 1, 3650}, {"CLEANUP_OUTBOX_DAYS", &c.OutboxDays, 30, 1, 3650},
		{"CLEANUP_AUDIT_DAYS", &c.AuditDays, 365, 1, 36500},
	}
	for _, field := range fields {
		value, err := integer(field.key, field.fallback)
		if err != nil || value < field.min || value > field.max {
			return c, fmt.Errorf("invalid %s", field.key)
		}
		*field.value = value
	}
	var err error
	c.AuditEnabled, err = boolean("CLEANUP_AUDIT_ENABLED", false)
	if err != nil {
		return c, fmt.Errorf("invalid CLEANUP_AUDIT_ENABLED")
	}
	if c.AuditEnabled && os.Getenv("CLEANUP_AUDIT_DAYS") == "" {
		return c, fmt.Errorf("audit cleanup requires explicit CLEANUP_AUDIT_DAYS")
	}
	if c.RenewSeconds*2 >= c.LeaseSeconds {
		return c, fmt.Errorf("lease renewal must be less than half the lease duration")
	}
	return c, nil
}
