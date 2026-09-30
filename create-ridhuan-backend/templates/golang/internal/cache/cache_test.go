package cache

import (
	"context"
	"net"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestDisabledCacheNeverUsesRedis(t *testing.T) {
	key, err := New(nil, false, "test-cache").Key(context.Background(), "user.get", "actor", "/api/users/1")
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
	cache := New(client, true, "test-cache")
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

func TestUnresponsiveRedisHasBoundedCacheWait(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		connection, e := listener.Accept()
		if e == nil {
			defer connection.Close()
			<-finished
		}
	}()
	client := redis.NewClient(&redis.Options{Addr: listener.Addr().String(), ContextTimeoutEnabled: true, ReadTimeout: time.Minute, WriteTimeout: time.Minute, MaxRetries: -1})
	defer client.Close()
	start := time.Now()
	_, err = New(client, true, "bounded-cache").Key(t.Context(), "user.get", "actor", "/resource")
	if err == nil {
		t.Fatal("unresponsive cache unexpectedly succeeded")
	}
	if time.Since(start) > time.Second {
		t.Fatal("optional Redis cache exceeded fallback deadline")
	}
}
