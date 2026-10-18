package config

import (
	"fmt"
	"strings"
	"testing"
)

func TestProviderIdentifierLimits(t *testing.T) {
	for _, item := range []struct {
		provider       string
		user, database int
		valid          bool
	}{
		{"mysql", 32, 64, true}, {"mysql", 33, 64, false}, {"mysql", 32, 65, false},
		{"postgresql", 63, 63, true}, {"postgresql", 64, 63, false}, {"postgresql", 63, 64, false},
	} {
		t.Run(fmt.Sprintf("%s-user%d-db%d", item.provider, item.user, item.database), func(t *testing.T) {
			t.Setenv("NODE_ENV", "test")
			t.Setenv("DB_PROVIDER", item.provider)
			t.Setenv("JWT_SECRET", strings.Repeat("x", 40))
			t.Setenv("DATABASE_URL", fmt.Sprintf("%s://%s:fixture@localhost:5432/%s", item.provider, strings.Repeat("u", item.user), strings.Repeat("d", item.database)))
			_, err := Load()
			if (err == nil) != item.valid {
				t.Fatalf("expected accepted=%v, got %v", item.valid, err)
			}
		})
	}
}

func TestProductionRequiresCORS(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://fixture_user:fixture_password@localhost:5432/fixture_db")
	t.Setenv("JWT_SECRET", "this_is_a_long_test_secret_over_32_chars")
	t.Setenv("CORS_ORIGINS", "")
	if _, err := Load(); err == nil {
		t.Fatal("production allowed empty CORS_ORIGINS")
	}
}
func TestMultiInstanceRequiresRedis(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://fixture_user:fixture_password@localhost:5432/fixture_db")
	t.Setenv("JWT_SECRET", "this_is_a_long_test_secret_over_32_chars")
	t.Setenv("APP_INSTANCE_COUNT", "2")
	t.Setenv("RATE_LIMIT_STORE", "memory")
	if _, err := Load(); err == nil {
		t.Fatal("multi-instance memory rate limiter accepted")
	}
}
func TestSMTPConfigurationIsOptionalButValidatedWhenEnabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://fixture_user:fixture_password@localhost:5432/fixture_db")
	t.Setenv("JWT_SECRET", "this_is_a_long_test_secret_over_32_chars")
	t.Setenv("SMTP_ENABLED", "false")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SMTP_ENABLED", "true")
	if _, err := Load(); err == nil {
		t.Fatal("enabled SMTP without host accepted")
	}
	t.Setenv("SMTP_HOST", "smtp.example.test")
	t.Setenv("SMTP_FROM", "not-an-email")
	if _, err := Load(); err == nil {
		t.Fatal("invalid sender accepted")
	}
	t.Setenv("SMTP_FROM", "robot@example.test")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshLifetimes(t *testing.T) {
	for _, item := range []struct {
		idle, absolute string
		valid          bool
	}{
		{"", "", true}, {"7", "14", true}, {"0", "90", false}, {"30", "0", false}, {"31", "30", false}, {"30", "3651", false}, {"x", "90", false},
	} {
		t.Run(item.idle+"-"+item.absolute, func(t *testing.T) {
			t.Setenv("NODE_ENV", "test")
			t.Setenv("DATABASE_URL", "postgres://fixture_user:fixture_password@localhost:5432/fixture_db")
			t.Setenv("JWT_SECRET", strings.Repeat("x", 40))
			if item.idle != "" {
				t.Setenv("REFRESH_TOKEN_IDLE_DAYS", item.idle)
				t.Setenv("REFRESH_TOKEN_ABSOLUTE_DAYS", item.absolute)
			}
			c, err := Load()
			if (err == nil) != item.valid {
				t.Fatalf("expected accepted=%v, got %v", item.valid, err)
			}
			if item.idle == "" && (c.RefreshIdleDays != 30 || c.RefreshAbsoluteDays != 90) {
				t.Fatalf("defaults %d/%d", c.RefreshIdleDays, c.RefreshAbsoluteDays)
			}
		})
	}
}
