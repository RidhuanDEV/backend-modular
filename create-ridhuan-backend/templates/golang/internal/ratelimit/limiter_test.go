package ratelimit

import (
	"context"
	"testing"

	"github.com/RidhuanDEV/golang-backend/internal/config"
)

func TestMemoryLimitPerKey(t *testing.T) {
	limiter := New(nil)
	rate := config.Rate{WindowMS: 60000, Max: 2}
	for i := 0; i < 3; i++ {
		allowed, err := limiter.Allow(context.Background(), "auth", "client-a", rate)
		if err != nil {
			t.Fatal(err)
		}
		if allowed != (i < 2) {
			t.Fatalf("attempt %d: allowed=%t", i, allowed)
		}
	}
	allowed, err := limiter.Allow(context.Background(), "auth", "client-b", rate)
	if err != nil || !allowed {
		t.Fatalf("independent key blocked: %v", err)
	}
}
