package ratelimit

import (
	"context"
	"fmt"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"sync"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/redis/go-redis/v9"
)

type bucket struct {
	Count   int64
	Expires time.Time
}
type Limiter struct {
	redis     *redis.Client
	namespace string
	mu        sync.Mutex
	memory    map[string]bucket
}

func New(client *redis.Client, namespace string) *Limiter {
	return &Limiter{redis: client, namespace: namespace, memory: map[string]bucket{}}
}

var fixedWindow = redis.NewScript(`local count=redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return count`)

func (l *Limiter) Allow(ctx context.Context, group, key string, rate config.Rate) (bool, error) {
	ctx, span := telemetry.Start(ctx, "redis")
	defer span.End()
	window := time.Duration(rate.WindowMS) * time.Millisecond
	windowID := time.Now().UnixMilli() / rate.WindowMS
	fullKey := fmt.Sprintf("%s:ratelimit:%s:%s:%d", l.namespace, group, key, windowID)
	if l.redis != nil {
		count, err := fixedWindow.Run(ctx, l.redis, []string{fullKey}, rate.WindowMS).Int64()
		if err != nil {
			return false, err
		}
		return count <= rate.Max, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.prune()
	b := l.memory[fullKey]
	if b.Count == 0 {
		b.Expires = time.Now().Add(window)
	}
	b.Count++
	l.memory[fullKey] = b
	return b.Count <= rate.Max, nil
}

const maxMemoryBuckets = 10000

// prune bounds the memory store: drop expired buckets, then arbitrary ones down
// to 90% of the cap, so the O(n) sweep runs once per batch instead of on every
// request. A flood of distinct keys can therefore reset some counters early;
// the shared Redis store is required for production limits anyway.
func (l *Limiter) prune() {
	if len(l.memory) < maxMemoryBuckets {
		return
	}
	now := time.Now()
	for k, v := range l.memory {
		if now.After(v.Expires) {
			delete(l.memory, k)
		}
	}
	target := maxMemoryBuckets * 9 / 10
	for k := range l.memory {
		if len(l.memory) <= target {
			break
		}
		delete(l.memory, k)
	}
}
