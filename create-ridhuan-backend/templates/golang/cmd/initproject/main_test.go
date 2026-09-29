package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyTemplateUsesAllowlistAndRewritesModule(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "source")
	destination := filepath.Join(base, "destination")
	for _, directory := range []string{source, filepath.Join(source, "cmd"), filepath.Join(source, "contracts"), filepath.Join(source, ".tmp-postgres-test")} {
		if err := os.MkdirAll(directory, 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range map[string]string{"go.mod": "module " + originalModule, "cmd/main.go": "package main\nimport _ \"" + originalModule + "/internal/db\"", "contracts/express-endpoints.json": "{}", ".tmp-postgres-test/secret": "private", ".env": "JWT_SECRET=private"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := copyTemplate(source, destination, "example.com/project"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(destination, "cmd", "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "example.com/project/internal/db") {
		t.Fatal("module import was not rewritten")
	}
	if _, err := os.ReadFile(filepath.Join(destination, "contracts", "express-endpoints.json")); err != nil {
		t.Fatalf("contract fixture was not copied: %v", err)
	}
	for _, name := range []string{".env", ".tmp-postgres-test"} {
		if _, err := os.Stat(filepath.Join(destination, name)); !os.IsNotExist(err) {
			t.Fatalf("unexpected copied path %s: %v", name, err)
		}
	}
}
