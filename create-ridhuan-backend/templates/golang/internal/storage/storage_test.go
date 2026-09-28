package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
)

func TestLocalStoreAndTraversal(t *testing.T) {
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Put(context.Background(), "safe", strings.NewReader("hello")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(store.root, "safe"))
	if err != nil || string(data) != "hello" {
		t.Fatalf("stored bytes: %q, %v", data, err)
	}
	if err = store.Put(context.Background(), "../outside", strings.NewReader("bad")); err == nil {
		t.Fatal("path traversal accepted")
	}
	if err = store.Delete(context.Background(), "safe"); err != nil {
		t.Fatal(err)
	}
}

func TestS3AdapterUsesConfiguredEndpoint(t *testing.T) {
	var mu sync.Mutex
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.Path)
		mu.Unlock()
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>old-key</Key><LastModified>2025-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	c := config.Config{S3Endpoint: server.URL, S3Region: "us-east-1", S3Bucket: "uploads", S3AccessKey: "test", S3SecretKey: "test", S3PathStyle: true}
	store, err := NewS3(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Put(context.Background(), "sample", strings.NewReader("sample")); err != nil {
		t.Fatal(err)
	}
	keys, err := store.ListOlder(context.Background(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0] != "old-key" {
		t.Fatalf("list result %v", keys)
	}
	if err = store.Delete(context.Background(), "sample"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 3 || calls[0] != "PUT /uploads/sample" || calls[1] != "GET /uploads" || calls[2] != "DELETE /uploads/sample" {
		t.Fatalf("S3 requests %v", calls)
	}
}
