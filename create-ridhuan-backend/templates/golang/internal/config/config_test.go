package config

import "testing"

func TestProductionRequiresCORS(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "this_is_a_long_test_secret_over_32_chars")
	t.Setenv("CORS_ORIGINS", "")
	if _, err := Load(); err == nil {
		t.Fatal("production allowed empty CORS_ORIGINS")
	}
}
func TestMultiInstanceRequiresRedis(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "this_is_a_long_test_secret_over_32_chars")
	t.Setenv("APP_INSTANCE_COUNT", "2")
	t.Setenv("RATE_LIMIT_STORE", "memory")
	if _, err := Load(); err == nil {
		t.Fatal("multi-instance memory rate limiter accepted")
	}
}
func TestSMTPConfigurationIsOptionalButValidatedWhenEnabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
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
