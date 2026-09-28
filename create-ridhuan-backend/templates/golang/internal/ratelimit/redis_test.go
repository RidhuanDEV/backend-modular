package ratelimit

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestRedisLimitSharedAcrossInstances(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = client.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	key := uuid.NewString()
	rate := config.Rate{WindowMS: 60000, Max: 2}
	first := New(client)
	second := New(client)
	for index, limiter := range []*Limiter{first, second, first} {
		allowed, e := limiter.Allow(ctx, "auth", key, rate)
		if e != nil {
			t.Fatal(e)
		}
		if allowed != (index < 2) {
			t.Fatalf("attempt %d allowed=%t", index, allowed)
		}
	}
}
func TestRedisConcurrentLimitsAndExpiry(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	defer client.Close()
	first, second := New(client), New(client)
	key := uuid.NewString()
	rate := config.Rate{WindowMS: 1000, Max: 7}
	var accepted atomic.Int32
	var group sync.WaitGroup
	failures := make(chan error, 30)
	for i := 0; i < 30; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			limiter := first
			if i%2 == 0 {
				limiter = second
			}
			allowed, err := limiter.Allow(t.Context(), "auth", key, rate)
			if err != nil {
				failures <- err
			} else if allowed {
				accepted.Add(1)
			}
		}(i)
	}
	group.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	if accepted.Load() != 7 {
		t.Fatal("non-atomic quota", accepted.Load())
	}
	time.Sleep(1100 * time.Millisecond)
	if allowed, err := second.Allow(t.Context(), "auth", key, rate); err != nil || !allowed {
		t.Fatal("window did not expire", allowed, err)
	}
}
