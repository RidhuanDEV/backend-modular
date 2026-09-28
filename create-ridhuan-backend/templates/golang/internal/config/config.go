package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Rate struct {
	WindowMS int64
	Max      int64
}
type PolicyOverride struct {
	Audit     string `json:"audit"`
	RateLimit string `json:"rateLimit"`
	Cache     string `json:"cache"`
}
type Config struct {
	Environment            string
	Port                   int
	DatabaseURL            string
	JWTSecret              string
	JWTIssuer              string
	JWTAudience            string
	CORSOrigins            map[string]struct{}
	RedisURL               string
	CacheEnabled           bool
	RateStore              string
	Rates                  map[string]Rate
	InstanceCount          int
	TrustProxyHops         int
	Policies               map[string]PolicyOverride
	UploadEnabled          bool
	UploadStorage          string
	UploadLocalDir         string
	UploadMaxBytes         int64
	UploadAllowedMIME      map[string]struct{}
	UploadOrphanGraceHours int
	S3Endpoint             string
	S3Region               string
	S3Bucket               string
	S3AccessKey            string
	S3SecretKey            string
	S3PathStyle            bool
	OTelEnabled            bool
	OTelServiceName        string
	OTelEndpoint           string
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}
func integer(key string, fallback int) (int, error) {
	v, err := strconv.Atoi(getenv(key, strconv.Itoa(fallback)))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return v, nil
}
func boolean(key string, fallback bool) (bool, error) {
	v := strconv.FormatBool(fallback)
	return strconv.ParseBool(getenv(key, v))
}

func Load() (Config, error) {
	c := Config{
		Environment:       getenv("NODE_ENV", "development"),
		Port:              3000,
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		JWTSecret:         os.Getenv("JWT_SECRET"),
		JWTIssuer:         os.Getenv("JWT_ISSUER"),
		JWTAudience:       os.Getenv("JWT_AUDIENCE"),
		CORSOrigins:       map[string]struct{}{},
		RedisURL:          os.Getenv("REDIS_URL"),
		RateStore:         getenv("RATE_LIMIT_STORE", "memory"),
		Rates:             map[string]Rate{},
		Policies:          map[string]PolicyOverride{},
		UploadStorage:     getenv("UPLOAD_STORAGE", "local"),
		UploadLocalDir:    getenv("UPLOAD_LOCAL_DIR", "./uploads"),
		UploadAllowedMIME: map[string]struct{}{},
		S3Endpoint:        os.Getenv("S3_ENDPOINT"),
		S3Region:          os.Getenv("S3_REGION"),
		S3Bucket:          os.Getenv("S3_BUCKET"),
		S3AccessKey:       os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey:       os.Getenv("S3_SECRET_ACCESS_KEY"),
		OTelServiceName:   getenv("OTEL_SERVICE_NAME", "modular-golang"),
		OTelEndpoint:      os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
	}
	var err error
	if c.Port, err = integer("PORT", 3000); err != nil {
		return c, err
	}
	if c.InstanceCount, err = integer("APP_INSTANCE_COUNT", 1); err != nil {
		return c, err
	}
	if c.TrustProxyHops, err = integer("TRUST_PROXY_HOPS", 0); err != nil {
		return c, err
	}
	if c.UploadOrphanGraceHours, err = integer("UPLOAD_ORPHAN_GRACE_HOURS", 24); err != nil {
		return c, err
	}
	maxBytes, err := integer("UPLOAD_MAX_BYTES", 10485760)
	if err != nil {
		return c, err
	}
	c.UploadMaxBytes = int64(maxBytes)
	if c.CacheEnabled, err = boolean("CACHE_ENABLED", false); err != nil {
		return c, fmt.Errorf("CACHE_ENABLED: %w", err)
	}
	if c.UploadEnabled, err = boolean("UPLOAD_ENABLED", true); err != nil {
		return c, fmt.Errorf("UPLOAD_ENABLED: %w", err)
	}
	if c.S3PathStyle, err = boolean("S3_FORCE_PATH_STYLE", true); err != nil {
		return c, fmt.Errorf("S3_FORCE_PATH_STYLE: %w", err)
	}
	if c.OTelEnabled, err = boolean("OTEL_ENABLED", false); err != nil {
		return c, fmt.Errorf("OTEL_ENABLED: %w", err)
	}
	for _, group := range []string{"AUTH", "PUBLIC", "INTERNAL"} {
		window, e := integer("RATE_LIMIT_"+group+"_WINDOW_MS", 900000)
		if e != nil {
			return c, e
		}
		maximum, e := integer("RATE_LIMIT_"+group+"_MAX", map[string]int{"AUTH": 20, "PUBLIC": 100, "INTERNAL": 300}[group])
		if e != nil {
			return c, e
		}
		if window <= 0 || maximum <= 0 {
			return c, fmt.Errorf("rate %s must be positive", group)
		}
		c.Rates[strings.ToLower(group)] = Rate{int64(window), int64(maximum)}
	}
	corsDefault := "http://localhost:5173,http://localhost:3000"
	if c.Environment == "production" {
		corsDefault = ""
	}
	for _, item := range strings.Split(getenv("CORS_ORIGINS", corsDefault), ",") {
		origin := strings.TrimSpace(item)
		if origin == "" {
			continue
		}
		u, e := url.Parse(origin)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.String() != origin || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return c, fmt.Errorf("invalid CORS origin %q", origin)
		}
		c.CORSOrigins[origin] = struct{}{}
	}
	for _, item := range strings.Split(getenv("UPLOAD_ALLOWED_MIME", "image/png,image/jpeg,application/pdf"), ",") {
		if v := strings.TrimSpace(item); v != "" {
			c.UploadAllowedMIME[v] = struct{}{}
		}
	}
	policyDecoder := json.NewDecoder(strings.NewReader(getenv("ENDPOINT_POLICIES_JSON", "{}")))
	policyDecoder.DisallowUnknownFields()
	if err = policyDecoder.Decode(&c.Policies); err != nil {
		return c, fmt.Errorf("ENDPOINT_POLICIES_JSON: %w", err)
	}
	if c.Policies == nil {
		return c, errors.New("ENDPOINT_POLICIES_JSON must be an object")
	}
	if c.Port < 1 || c.Port > 65535 || c.InstanceCount < 1 || c.TrustProxyHops < 0 || c.UploadMaxBytes < 1 || c.UploadMaxBytes > 104857600 || c.UploadOrphanGraceHours < 1 {
		return c, errors.New("invalid numeric configuration")
	}
	if c.DatabaseURL == "" || len(c.JWTSecret) < 32 {
		return c, errors.New("DATABASE_URL and JWT_SECRET (minimum 32 characters) are required")
	}
	if c.Environment != "development" && c.Environment != "production" && c.Environment != "test" {
		return c, errors.New("NODE_ENV must be development, production, or test")
	}
	if c.Environment == "production" && len(c.CORSOrigins) == 0 {
		return c, errors.New("CORS_ORIGINS is required in production")
	}
	if c.RateStore != "memory" && c.RateStore != "redis" {
		return c, errors.New("RATE_LIMIT_STORE must be memory or redis")
	}
	if c.InstanceCount > 1 && c.RateStore == "memory" {
		return c, errors.New("Redis rate store is required for multiple app instances")
	}
	if (c.CacheEnabled || c.RateStore == "redis") && c.RedisURL == "" {
		return c, errors.New("REDIS_URL is required when Redis is enabled")
	}
	if c.UploadStorage != "local" && c.UploadStorage != "s3" {
		return c, errors.New("UPLOAD_STORAGE must be local or s3")
	}
	if c.UploadEnabled && c.UploadStorage == "s3" && (c.S3Region == "" || c.S3Bucket == "" || c.S3AccessKey == "" || c.S3SecretKey == "") {
		return c, errors.New("S3 region, bucket and credentials are required")
	}
	if c.OTelEnabled {
		u, e := url.Parse(c.OTelEndpoint)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, errors.New("OTEL_EXPORTER_OTLP_ENDPOINT must be an HTTP URL when OTel is enabled")
		}
	}
	return c, nil
}
