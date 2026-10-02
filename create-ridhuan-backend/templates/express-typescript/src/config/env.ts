import { loadEnvironment } from "./load-env.js";
import { operationsConfig } from "../core/jobs/operations.js";
import { z } from "zod";

loadEnvironment();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform(
        (value) =>
          value
            ?.split(",")
            .map((origin) => origin.trim())
            .filter(Boolean) ?? [],
      ),
    DATABASE_URL: z.string().min(1),
    DB_PROVIDER: z.enum(["postgresql", "mysql"]).default("postgresql"),
    REDIS_NAMESPACE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .default("modular-express"),
    REDIS_URL: z.string().url().optional(),
    CACHE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),
    ENDPOINT_POLICIES_JSON: z.string().default("{}"),
    RATE_LIMIT_AUTH_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_PUBLIC_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_INTERNAL_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(900000),
    RATE_LIMIT_INTERNAL_MAX: z.coerce.number().int().positive().default(300),
    APP_INSTANCE_COUNT: z.coerce.number().int().positive().default(1),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    UPLOAD_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    UPLOAD_STORAGE: z.enum(["local", "s3"]).default("local"),
    UPLOAD_LOCAL_DIR: z.string().min(1).default("./uploads"),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(104857600)
      .default(10485760),
    UPLOAD_ALLOWED_MIME: z
      .string()
      .default("image/png,image/jpeg,application/pdf"),
    UPLOAD_ORPHAN_GRACE_HOURS: z.coerce.number().int().positive().default(24),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default("modular-express"),
    JWT_AUDIENCE: z.string().min(1).default("modular-express-api"),
    SMTP_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z
      .union([z.email(), z.literal("")])
      .optional()
      .transform((value) => value || undefined),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  })
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value.DATABASE_URL);
      const username = decodeURIComponent(url.username);
      const database = decodeURIComponent(url.pathname.slice(1));
      const databaseMaximum = value.DB_PROVIDER === "mysql" ? 64 : 63;
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(database) ||
        database.length > databaseMaximum
      )
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: `${value.DB_PROVIDER} database name must be an ASCII SQL identifier (maximum ${databaseMaximum} characters)`,
        });
      const maximum = value.DB_PROVIDER === "mysql" ? 32 : 63;
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(username) ||
        username.length > maximum
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: `${value.DB_PROVIDER} username must be an ASCII SQL identifier (maximum ${maximum} characters)`,
        });
      }
      if (
        !(
          value.DB_PROVIDER === "mysql"
            ? ["mysql:"]
            : ["postgres:", "postgresql:"]
        ).includes(url.protocol)
      )
        throw new Error("provider mismatch");
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL does not match DB_PROVIDER",
      });
    }
    if (
      value.SMTP_ENABLED &&
      (!value.SMTP_HOST ||
        !value.SMTP_FROM ||
        Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_ENABLED"],
        message: "SMTP requires host, sender, and matching username/password",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      /change_this|replace|example/i.test(value.JWT_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be a generated secret in production",
      });
    }
    if (value.NODE_ENV === "production" && value.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS is required in production",
      });
    }
    for (const origin of value.CORS_ORIGINS) {
      try {
        const url = new URL(origin);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.origin !== origin
        )
          throw new Error("Invalid origin");
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ORIGINS"],
          message: `Invalid CORS origin: ${origin}`,
        });
      }
    }
    if (
      (value.CACHE_ENABLED || value.RATE_LIMIT_STORE === "redis") &&
      !value.REDIS_URL
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "REDIS_URL is required when Redis is enabled",
      });
    }
    if (value.APP_INSTANCE_COUNT > 1 && value.RATE_LIMIT_STORE === "memory") {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_STORE"],
        message:
          "Redis rate limit store is required for multiple app instances",
      });
    }
    if (value.UPLOAD_ENABLED && value.UPLOAD_STORAGE === "s3") {
      for (const key of [
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required for S3 uploads`,
          });
      }
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

operationsConfig();
export const env = result.data;
export type Env = z.infer<typeof envSchema>;
