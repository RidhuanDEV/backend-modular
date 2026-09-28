package ratelimit

import (
	"context"
	"fmt"
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
	redis  *redis.Client
	mu     sync.Mutex
	memory map[string]bucket
}

func New(client *redis.Client) *Limiter { return &Limiter{redis: client, memory: map[string]bucket{}} }

var fixedWindow = redis.NewScript(`local count=redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return count`)

func (l *Limiter) Allow(ctx context.Context, group, key string, rate config.Rate) (bool, error) {
	window := time.Duration(rate.WindowMS) * time.Millisecond
	windowID := time.Now().UnixMilli() / rate.WindowMS
	fullKey := fmt.Sprintf("ratelimit:%s:%s:%d", group, key, windowID)
	if l.redis != nil {
		count, err := fixedWindow.Run(ctx, l.redis, []string{fullKey}, rate.WindowMS).Int64()
		if err != nil {
			return false, err
		}
		return count <= rate.Max, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.memory) > 10000 {
		now := time.Now()
		for k, v := range l.memory {
			if now.After(v.Expires) {
				delete(l.memory, k)
			}
		}
	}
	b := l.memory[fullKey]
	if b.Count == 0 {
		b.Expires = time.Now().Add(window)
	}
	b.Count++
	l.memory[fullKey] = b
	return b.Count <= rate.Max, nil
}
