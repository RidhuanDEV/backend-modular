import { telemetryConfig } from "../common/observability/telemetry";
import { operationsConfig } from "../platform/jobs/operations";
import { plainToInstance, Type } from "class-transformer";
import {
  IsIn,
  isEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  validateSync,
} from "class-validator";

export type Environment = "development" | "test" | "production";
export type RateStore = "memory" | "redis";
export type UploadStorage = "local" | "s3";

class EnvironmentInput {
  @IsIn(["postgresql", "mysql"])
  DB_PROVIDER!: "postgresql" | "mysql";
  @IsIn(["development", "test", "production"])
  NODE_ENV!: Environment;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT!: number;

  @IsString()
  CORS_ORIGINS!: string;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  @MinLength(1)
  JWT_ISSUER!: string;

  @IsString()
  @MinLength(1)
  JWT_AUDIENCE!: string;

  @IsString()
  ENDPOINT_POLICIES_JSON!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  APP_INSTANCE_COUNT!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS!: number;

  @IsIn(["memory", "redis"])
  RATE_LIMIT_STORE!: RateStore;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @MinLength(1)
  REDIS_NAMESPACE!: string;

  @IsIn(["true", "false"])
  CACHE_ENABLED!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_WINDOW_MS!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_MAX!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_PUBLIC_WINDOW_MS!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_PUBLIC_MAX!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_INTERNAL_WINDOW_MS!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_INTERNAL_MAX!: number;

  @IsIn(["true", "false"])
  UPLOAD_ENABLED!: string;
  @IsIn(["local", "s3"])
  UPLOAD_STORAGE!: UploadStorage;
  @IsString()
  @MinLength(1)
  UPLOAD_LOCAL_DIR!: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  UPLOAD_MAX_BYTES!: number;
  @IsString()
  @MinLength(1)
  UPLOAD_ALLOWED_MIME!: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  UPLOAD_ORPHAN_GRACE_HOURS!: number;

  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;
  @IsString()
  @IsOptional()
  S3_REGION?: string;
  @IsString()
  @IsOptional()
  S3_BUCKET?: string;
  @IsString()
  @IsOptional()
  S3_ACCESS_KEY_ID?: string;
  @IsString()
  @IsOptional()
  S3_SECRET_ACCESS_KEY?: string;
  @IsIn(["true", "false"])
  S3_FORCE_PATH_STYLE!: string;

  @IsIn(["true", "false"])
  SMTP_ENABLED!: string;
  @IsIn(["true", "false"]) SMTP_SECURE!: string;
  @IsString() @IsOptional() SMTP_HOST?: string;
  @Type(() => Number) @IsInt() @Min(1) SMTP_PORT!: number;
  @IsString() @IsOptional() SMTP_USER?: string;
  @IsString() @IsOptional() SMTP_PASSWORD?: string;
  @IsString() @IsOptional() SMTP_FROM?: string;
}

export interface AppConfig {
  DB_PROVIDER: "postgresql" | "mysql";
  NODE_ENV: Environment;
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ENDPOINT_POLICIES_JSON: string;
  APP_INSTANCE_COUNT: number;
  TRUST_PROXY_HOPS: number;
  RATE_LIMIT_STORE: RateStore;
  REDIS_URL?: string;
  REDIS_NAMESPACE: string;
  CACHE_ENABLED: boolean;
  RATE_LIMIT_AUTH_WINDOW_MS: number;
  RATE_LIMIT_AUTH_MAX: number;
  RATE_LIMIT_PUBLIC_WINDOW_MS: number;
  RATE_LIMIT_PUBLIC_MAX: number;
  RATE_LIMIT_INTERNAL_WINDOW_MS: number;
  RATE_LIMIT_INTERNAL_MAX: number;
  UPLOAD_ENABLED: boolean;
  UPLOAD_STORAGE: UploadStorage;
  UPLOAD_LOCAL_DIR: string;
  UPLOAD_MAX_BYTES: number;
  UPLOAD_ALLOWED_MIME: string[];
  UPLOAD_ORPHAN_GRACE_HOURS: number;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE: boolean;
  SMTP_ENABLED: boolean;
  SMTP_SECURE: boolean;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
}

const defaults: Record<string, string> = {
  DB_PROVIDER: "postgresql",
  NODE_ENV: "development",
  PORT: "3000",
  CORS_ORIGINS: "http://localhost:5173,http://localhost:3000",
  JWT_ISSUER: "modular-nestjs",
  JWT_AUDIENCE: "modular-nestjs-api",
  ENDPOINT_POLICIES_JSON: "{}",
  APP_INSTANCE_COUNT: "1",
  TRUST_PROXY_HOPS: "0",
  RATE_LIMIT_STORE: "memory",
  CACHE_ENABLED: "false",
  REDIS_NAMESPACE: "modular-nestjs",
  RATE_LIMIT_AUTH_WINDOW_MS: "900000",
  RATE_LIMIT_AUTH_MAX: "20",
  RATE_LIMIT_PUBLIC_WINDOW_MS: "900000",
  RATE_LIMIT_PUBLIC_MAX: "100",
  RATE_LIMIT_INTERNAL_WINDOW_MS: "900000",
  RATE_LIMIT_INTERNAL_MAX: "300",
  UPLOAD_ENABLED: "true",
  UPLOAD_STORAGE: "local",
  UPLOAD_LOCAL_DIR: "./uploads",
  UPLOAD_MAX_BYTES: "10485760",
  UPLOAD_ALLOWED_MIME: "image/png,image/jpeg,application/pdf",
  UPLOAD_ORPHAN_GRACE_HOURS: "24",
  S3_FORCE_PATH_STYLE: "true",
  SMTP_ENABLED: "false",
  SMTP_SECURE: "false",
  SMTP_PORT: "587",
};

function parseOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins");
    }
  }
  return origins;
}

export function validateEnvironment(raw: Record<string, unknown>): AppConfig {
  const operationalEnvironment = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : undefined,
    ]),
  );
  operationsConfig(operationalEnvironment);
  telemetryConfig(operationalEnvironment);
  const merged = { ...defaults, ...raw };
  if (merged.NODE_ENV === "production" && !raw.CORS_ORIGINS)
    merged.CORS_ORIGINS = "";
  const input = plainToInstance(EnvironmentInput, merged, {
    enableImplicitConversion: false,
  });
  const username = decodeURIComponent(new URL(input.DATABASE_URL).username);
  const database = decodeURIComponent(
    new URL(input.DATABASE_URL).pathname.slice(1),
  );
  const databaseMaximum = input.DB_PROVIDER === "mysql" ? 64 : 63;
  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database) ||
    database.length > databaseMaximum
  )
    throw new Error(
      `${input.DB_PROVIDER} database name must be an ASCII SQL identifier (maximum ${databaseMaximum} characters)`,
    );
  const maximum = input.DB_PROVIDER === "mysql" ? 32 : 63;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(username) || username.length > maximum)
    throw new Error(
      `${input.DB_PROVIDER} username must be an ASCII SQL identifier (maximum ${maximum} characters)`,
    );
  const errors = validateSync(input, {
    skipMissingProperties: false,
    whitelist: true,
  });
  if (errors.length) {
    const keys = errors.map((error) => error.property).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  if (
    input.PORT > 65535 ||
    !(
      input.DB_PROVIDER === "mysql" ? /^mysql:\/\// : /^postgres(?:ql)?:\/\//
    ).test(input.DATABASE_URL)
  ) {
    throw new Error("PORT or DATABASE_URL is invalid");
  }
  if (
    input.NODE_ENV === "production" &&
    /replace|change|example|test/i.test(input.JWT_SECRET)
  ) {
    throw new Error("JWT_SECRET must be a real secret in production");
  }
  const origins = parseOrigins(input.CORS_ORIGINS);
  if (input.NODE_ENV === "production" && origins.length === 0) {
    throw new Error("CORS_ORIGINS is required in production");
  }
  if (input.APP_INSTANCE_COUNT > 1 && input.RATE_LIMIT_STORE !== "redis") {
    throw new Error(
      "RATE_LIMIT_STORE=redis is required for multiple instances",
    );
  }
  if (
    (input.CACHE_ENABLED === "true" || input.RATE_LIMIT_STORE === "redis") &&
    !input.REDIS_URL
  ) {
    throw new Error("REDIS_URL is required when Redis is enabled");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.REDIS_NAMESPACE)) {
    throw new Error(
      "REDIS_NAMESPACE must use lowercase letters, numbers, underscores or hyphens",
    );
  }
  if (
    input.UPLOAD_ENABLED === "true" &&
    input.UPLOAD_STORAGE === "s3" &&
    (!input.S3_REGION ||
      !input.S3_BUCKET ||
      !input.S3_ACCESS_KEY_ID ||
      !input.S3_SECRET_ACCESS_KEY)
  ) {
    throw new Error("S3 region, bucket and credentials are required");
  }
  if (
    input.SMTP_PORT > 65535 ||
    (input.SMTP_ENABLED === "true" &&
      (!input.SMTP_HOST ||
        !input.SMTP_FROM ||
        !isEmail(input.SMTP_FROM) ||
        Boolean(input.SMTP_USER) !== Boolean(input.SMTP_PASSWORD)))
  ) {
    throw new Error(
      "SMTP requires a valid port, host, sender and matching username/password",
    );
  }
  return {
    DB_PROVIDER: input.DB_PROVIDER,
    NODE_ENV: input.NODE_ENV,
    PORT: input.PORT,
    CORS_ORIGINS: origins,
    DATABASE_URL: input.DATABASE_URL,
    JWT_SECRET: input.JWT_SECRET,
    JWT_ISSUER: input.JWT_ISSUER,
    JWT_AUDIENCE: input.JWT_AUDIENCE,
    ENDPOINT_POLICIES_JSON: input.ENDPOINT_POLICIES_JSON,
    APP_INSTANCE_COUNT: input.APP_INSTANCE_COUNT,
    TRUST_PROXY_HOPS: input.TRUST_PROXY_HOPS,
    RATE_LIMIT_STORE: input.RATE_LIMIT_STORE,
    ...(input.REDIS_URL ? { REDIS_URL: input.REDIS_URL } : {}),
    REDIS_NAMESPACE: input.REDIS_NAMESPACE,
    CACHE_ENABLED: input.CACHE_ENABLED === "true",
    RATE_LIMIT_AUTH_WINDOW_MS: input.RATE_LIMIT_AUTH_WINDOW_MS,
    RATE_LIMIT_AUTH_MAX: input.RATE_LIMIT_AUTH_MAX,
    RATE_LIMIT_PUBLIC_WINDOW_MS: input.RATE_LIMIT_PUBLIC_WINDOW_MS,
    RATE_LIMIT_PUBLIC_MAX: input.RATE_LIMIT_PUBLIC_MAX,
    RATE_LIMIT_INTERNAL_WINDOW_MS: input.RATE_LIMIT_INTERNAL_WINDOW_MS,
    RATE_LIMIT_INTERNAL_MAX: input.RATE_LIMIT_INTERNAL_MAX,
    UPLOAD_ENABLED: input.UPLOAD_ENABLED === "true",
    UPLOAD_STORAGE: input.UPLOAD_STORAGE,
    UPLOAD_LOCAL_DIR: input.UPLOAD_LOCAL_DIR,
    UPLOAD_MAX_BYTES: input.UPLOAD_MAX_BYTES,
    UPLOAD_ALLOWED_MIME: input.UPLOAD_ALLOWED_MIME.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    UPLOAD_ORPHAN_GRACE_HOURS: input.UPLOAD_ORPHAN_GRACE_HOURS,
    ...(input.S3_ENDPOINT ? { S3_ENDPOINT: input.S3_ENDPOINT } : {}),
    ...(input.S3_REGION ? { S3_REGION: input.S3_REGION } : {}),
    ...(input.S3_BUCKET ? { S3_BUCKET: input.S3_BUCKET } : {}),
    ...(input.S3_ACCESS_KEY_ID
      ? { S3_ACCESS_KEY_ID: input.S3_ACCESS_KEY_ID }
      : {}),
    ...(input.S3_SECRET_ACCESS_KEY
      ? { S3_SECRET_ACCESS_KEY: input.S3_SECRET_ACCESS_KEY }
      : {}),
    S3_FORCE_PATH_STYLE: input.S3_FORCE_PATH_STYLE === "true",
    SMTP_ENABLED: input.SMTP_ENABLED === "true",
    SMTP_SECURE: input.SMTP_SECURE === "true",
    SMTP_PORT: input.SMTP_PORT,
    ...(input.SMTP_HOST ? { SMTP_HOST: input.SMTP_HOST } : {}),
    ...(input.SMTP_USER ? { SMTP_USER: input.SMTP_USER } : {}),
    ...(input.SMTP_PASSWORD ? { SMTP_PASSWORD: input.SMTP_PASSWORD } : {}),
    ...(input.SMTP_FROM ? { SMTP_FROM: input.SMTP_FROM } : {}),
  };
}
