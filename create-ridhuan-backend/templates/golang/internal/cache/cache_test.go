package cache

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestDisabledCacheNeverUsesRedis(t *testing.T) {
	key, err := New(nil, false).Key(context.Background(), "user.get", "actor", "/api/users/1")
	if err != nil || key != "" {
		t.Fatalf("disabled cache key %q: %v", key, err)
	}
}
func TestRedisCacheInvalidation(t *testing.T) {
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
	cache := New(client, true)
	endpoint := uuid.NewString()
	key, err := cache.Key(ctx, endpoint, "actor", "/resource")
	if err != nil {
		t.Fatal(err)
	}
	if err = cache.Put(ctx, key, []byte(`{"success":true}`)); err != nil {
		t.Fatal(err)
	}
	data, err := cache.Get(ctx, key)
	if err != nil || len(data) == 0 {
		t.Fatalf("cache miss: %v", err)
	}
	if err = cache.Invalidate(ctx); err != nil {
		t.Fatal(err)
	}
	next, err := cache.Key(ctx, endpoint, "actor", "/resource")
	if err != nil {
		t.Fatal(err)
	}
	if next == key {
		t.Fatal("cache version unchanged after mutation")
	}
}
