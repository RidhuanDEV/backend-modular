package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Cache struct {
	client  *redis.Client
	enabled bool
}

func New(client *redis.Client, enabled bool) *Cache { return &Cache{client: client, enabled: enabled} }
func (c *Cache) Key(ctx context.Context, endpoint, actor, url string) (string, error) {
	if !c.enabled || c.client == nil {
		return "", nil
	}
	version, err := c.client.Get(ctx, "cache:version").Result()
	if err == redis.Nil {
		version = "0"
	} else if err != nil {
		return "", err
	}
	return fmt.Sprintf("cache:v%s:%s:%s:%s", version, endpoint, actor, url), nil
}
func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
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
	if key == "" {
		return nil
	}
	return c.client.Set(ctx, key, value, 30*time.Second).Err()
}
func (c *Cache) Invalidate(ctx context.Context) error {
	if !c.enabled || c.client == nil {
		return nil
	}
	return c.client.Incr(ctx, "cache:version").Err()
}
