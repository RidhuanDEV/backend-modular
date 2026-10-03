package com.example.backend.config;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public final class Settings {
  public enum Provider {
    postgresql,
    mysql
  }

  public enum RateStore {
    memory,
    redis
  }

  public enum Storage {
    local,
    s3
  }

  private final Environment env;

  public Settings(Environment env) {
    this.env = env;
    provider();
    rateStore();
    storage();
    integer("PORT", 8080, 1, 65535);
    integer("DB_PORT", provider() == Provider.mysql ? 3306 : 5432, 1, 65535);
    identifier("DB_NAME", "backend", provider() == Provider.mysql ? 64 : 63);
    identifier("DB_USER", "backend", provider() == Provider.mysql ? 32 : 63);
    if (text("DB_PASSWORD", "").isBlank()) invalid("DB_PASSWORD");
    if (text("JWT_SECRET", "").getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32)
      invalid("JWT_SECRET");
    if (integer("APP_INSTANCE_COUNT", 1, 1, 1000) > 1 && rateStore() != RateStore.redis)
      invalid("RATE_LIMIT_STORE");
    if (text("APP_ENV", "development").equals("production")) {
      if (text("JWT_SECRET", "").contains("change")
          || text("ADMIN_PASSWORD", "").contains("change")
          || text("ADMIN_PASSWORD", "").length() < 12) invalid("ADMIN_PASSWORD/JWT_SECRET");
      if (text("CORS_ORIGINS", "").isBlank()) invalid("CORS_ORIGINS");
    }
    for (String key :
        List.of(
            "CACHE_ENABLED",
            "SMTP_ENABLED",
            "UPLOAD_ENABLED",
            "CLEANUP_DRY_RUN",
            "CLEANUP_AUDIT_ENABLED",
            "OTEL_ENABLED")) bool(key, false);
    for (String key : List.of("SMTP_AUTH", "SMTP_STARTTLS", "SMTP_SSL"))
      bool(key, !key.equals("SMTP_SSL"));
    integer("SMTP_PORT", 587, 1, 65535);
    integer("EMAIL_POLL_SECONDS", 3, 1, 60);
    integer("UPLOAD_MAX_BYTES", 10485760, 1, 1073741824);
    integer("CLEANUP_BATCH", 500, 1, 5000);
    integer("CLEANUP_RETENTION_DAYS", 30, 1, 36500);
    if (bool("CLEANUP_AUDIT_ENABLED", false)) {
      if (text("CLEANUP_AUDIT_RETENTION_DAYS", "").isBlank())
        invalid("CLEANUP_AUDIT_RETENTION_DAYS");
      integer("CLEANUP_AUDIT_RETENTION_DAYS", 365, 1, 36500);
    }
    for (String group : List.of("AUTH", "PUBLIC", "INTERNAL")) {
      integer("RATE_" + group + "_MAX", group.equals("AUTH") ? 30 : 300, 1, 10000000);
      integer("RATE_" + group + "_WINDOW_SECONDS", 60, 1, 3600);
    }
    String namespace = text("REDIS_NAMESPACE", "backend");
    if (!namespace.matches("[A-Za-z0-9_-]{1,80}")) invalid("REDIS_NAMESPACE");
    try {
      URI redis = URI.create(text("REDIS_URL", "redis://127.0.0.1:6379"));
      if (!List.of("redis", "rediss").contains(redis.getScheme())
          || redis.getHost() == null
          || redis.getFragment() != null) invalid("REDIS_URL");
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("Invalid setting REDIS_URL");
    }
    if (bool("SMTP_ENABLED", false)) {
      if (text("SMTP_HOST", "localhost").isBlank()) invalid("SMTP_HOST");
      if (bool("SMTP_AUTH", true)
          && (text("SMTP_USER", "").isBlank() || text("SMTP_PASSWORD", "").isBlank()))
        invalid("SMTP_USER/SMTP_PASSWORD");
      if (bool("SMTP_SSL", false) && bool("SMTP_STARTTLS", true)) invalid("SMTP_SSL/SMTP_STARTTLS");
    }
    if (bool("OTEL_ENABLED", false)) {
      uri("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318/v1/traces");
      uri("OTEL_METRICS_ENDPOINT", "http://localhost:4318/v1/metrics");
    }
    try {
      double rate = Double.parseDouble(text("OTEL_SAMPLE_RATE", "1.0"));
      if (!Double.isFinite(rate) || rate < 0 || rate > 1) invalid("OTEL_SAMPLE_RATE");
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("Invalid setting OTEL_SAMPLE_RATE");
    }
    integer("EMAIL_WORKER_CONCURRENCY", 2, 1, 16);
    if (integer("EMAIL_LEASE_SECONDS", 60, 30, 600)
        <= integer("EMAIL_RENEW_SECONDS", 20, 1, 120) + 25) invalid("EMAIL_LEASE_SECONDS");
    uri("S3_ENDPOINT", "http://localhost:9000");
    if (!s3Prefix().matches("[a-z0-9][a-z0-9._-]{0,127}")) invalid("S3_PREFIX");
    for (String origin : text("CORS_ORIGINS", "http://localhost:3000").split(",", -1)) {
      URI value;
      try {
        value = URI.create(origin.trim());
      } catch (IllegalArgumentException e) {
        throw new IllegalArgumentException("Invalid setting CORS_ORIGINS");
      }
      if (value.getHost() == null
          || value.getUserInfo() != null
          || !List.of("http", "https").contains(value.getScheme())
          || value.getQuery() != null
          || value.getFragment() != null
          || !value.getPath().isEmpty()) invalid("CORS_ORIGINS");
    }
  }

  public String text(String key, String fallback) {
    return env.getProperty(key, fallback);
  }

  public boolean bool(String key, boolean fallback) {
    String v = text(key, Boolean.toString(fallback));
    if (!v.equals("true") && !v.equals("false")) invalid(key);
    return Boolean.parseBoolean(v);
  }

  public int integer(String key, int fallback, int min, int max) {
    try {
      int v = Integer.parseInt(text(key, Integer.toString(fallback)));
      if (v < min || v > max) invalid(key);
      return v;
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("Invalid setting " + key);
    }
  }

  public Duration seconds(String key, int fallback) {
    return Duration.ofSeconds(integer(key, fallback, 1, 86400000));
  }

  public Provider provider() {
    return choice("DB_PROVIDER", Provider.postgresql, Provider.class);
  }

  public RateStore rateStore() {
    return choice("RATE_LIMIT_STORE", RateStore.memory, RateStore.class);
  }

  public Storage storage() {
    return choice("UPLOAD_STORAGE", Storage.local, Storage.class);
  }

  public URI uri(String key, String fallback) {
    try {
      URI value = URI.create(text(key, fallback));
      if (value.getHost() == null
          || value.getUserInfo() != null
          || !List.of("http", "https").contains(value.getScheme())) invalid(key);
      return value;
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("Invalid setting " + key);
    }
  }

  private <T extends Enum<T>> T choice(String key, T fallback, Class<T> type) {
    try {
      return Enum.valueOf(type, text(key, fallback.name()));
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("Invalid setting " + key);
    }
  }

  private void identifier(String key, String fallback, int max) {
    String v = text(key, fallback);
    if (!v.matches("[A-Za-z_][A-Za-z0-9_]*") || v.length() > max) invalid(key);
  }

  private static void invalid(String key) {
    throw new IllegalArgumentException("Invalid setting " + key);
  }

  public String s3Prefix() {
    return text("S3_PREFIX", "modular-springboot");
  }
}
