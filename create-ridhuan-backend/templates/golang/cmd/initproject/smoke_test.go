package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurrentTemplateCopiesEveryFeature(t *testing.T) {
	source, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "generated")
	if err = os.MkdirAll(destination, 0755); err != nil {
		t.Fatal(err)
	}
	if err = copyTemplate(source, destination, "example.com/generated"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"internal/auth/service.go", "internal/user/service.go", "internal/role/service.go", "internal/permission/service.go", "internal/upload/service.go", "internal/audit/audit.go", "internal/db/sqlc/user.sql.go", "contracts/express-schemas.json", "docs/OPERATIONS.md"} {
		data, err := os.ReadFile(filepath.Join(destination, name))
		if err != nil {
			t.Fatalf("missing generated source %s: %v", name, err)
		}
		if strings.HasSuffix(name, ".go") && strings.Contains(string(data), originalModule) {
			t.Fatalf("original module in %s", name)
		}
	}
	for _, name := range []string{".env", ".git", ".tmp-postgres-test", "docs/DOTNET-ENTERPRISE-TEMPLATE-PROMPT.md"} {
		if _, err = os.Stat(filepath.Join(destination, name)); !os.IsNotExist(err) {
			t.Fatalf("unexpected generated path %s", name)
		}
	}
}
