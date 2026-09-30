package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadEnvironmentQuotedCredentials(t *testing.T) {
	key := "CLI_ENV_ROUNDTRIP_TEST"
	original, existed := os.LookupEnv(key)
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, original)
		} else {
			_ = os.Unsetenv(key)
		}
	})
	_ = os.Unsetenv(key)
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(key+"='hash#$cash \"quoted\" apostrophe\\' back\\slash Unicode-日本'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := LoadEnvironment(path); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(key) != "hash#$cash \"quoted\" apostrophe' back\\slash Unicode-日本" {
		t.Fatal("quoted credential did not round trip")
	}
	if err := os.Setenv(key, "injected"); err != nil {
		t.Fatal(err)
	}
	if err := LoadEnvironment(path); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(key) != "injected" {
		t.Fatal("file replaced injected environment")
	}
}

func TestLoadEnvironmentBackslashAndDollarEdges(t *testing.T) {
	key := "CLI_ENV_EDGE_TEST"
	for _, value := range []string{"trailing\\", "slash\\'quote", "x\\$HOME $$x 日本"} {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), ".env")
		if err = os.WriteFile(path, []byte(key+"="+strings.ReplaceAll(string(encoded), "$", "\\$")+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		t.Setenv(key, "")
		if err = os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
		if err = LoadEnvironment(path); err != nil {
			t.Fatal(err)
		}
		if os.Getenv(key) != value {
			t.Fatal("escaped credential changed")
		}
	}
}
