package cache

import (
	"context"
	"fmt"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache struct {
	client    *redis.Client
	enabled   bool
	namespace string
}

func New(client *redis.Client, enabled bool, namespace string) *Cache {
	return &Cache{client: client, enabled: enabled, namespace: namespace}
}
func (c *Cache) Key(ctx context.Context, endpoint, actor, url string) (string, error) {
	ctx, span := telemetry.Start(ctx, "redis")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if !c.enabled || c.client == nil {
		return "", nil
	}
	version, err := c.client.Get(ctx, c.namespace+":cache:version").Result()
	if err == redis.Nil {
		version = "0"
	} else if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s:cache:v%s:%s:%s:%s", c.namespace, version, endpoint, actor, url), nil
}
func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	ctx, span := telemetry.Start(ctx, "redis")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if key == "" {
		return nil, nil
	}
	result, err := c.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	return result, err
}
func (c *Cache) Put(ctx context.Context, key string, value []byte) error {
	ctx, span := telemetry.Start(ctx, "redis")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if key == "" {
		return nil
	}
	return c.client.Set(ctx, key, value, 30*time.Second).Err()
}
func (c *Cache) Invalidate(ctx context.Context) error {
	ctx, span := telemetry.Start(ctx, "redis")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	if !c.enabled || c.client == nil {
		return nil
	}
	return c.client.Incr(ctx, c.namespace+":cache:version").Err()
}
