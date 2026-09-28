package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalPutDoesNotFollowExistingSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "protected")
	if err := os.WriteFile(target, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := NewLocal(filepath.Join(directory, "uploads"))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(target, filepath.Join(store.root, "key")); err != nil {
		t.Skipf("symlink requires platform permission: %v", err)
	}
	if err = store.Put(context.Background(), "key", strings.NewReader("overwrite")); err == nil {
		t.Fatal("existing symlink accepted")
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "original" {
		t.Fatal("symlink target changed", err)
	}
	if err = store.Delete(context.Background(), "key"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(target); err != nil {
		t.Fatal("delete followed symlink", err)
	}
}
