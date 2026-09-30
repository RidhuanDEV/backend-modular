import { randomBytes } from "node:crypto";
import { templateRegistry, usesLocalStorage } from "../templates.js";
import type { ProjectAnswers } from "../types.js";

export function serializeEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Environment values cannot contain newline or NUL");
  if (/^[A-Za-z0-9_:/.,@?%+=-]*$/.test(value)) return value;
  if (value.includes("\\")) return JSON.stringify(value).replaceAll("$", "\\$");
  // Compose does not interpolate single quoted values. Runtime loaders normalize escaped apostrophes.
  return `'${value.replaceAll("'", "\\'")}'`;
}
export function replaceEnv(template: string, replacements: Readonly<Record<string, string>>): string {
  const seen = new Set<string>();
  const lines = template.split(/\r?\n/).map((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    if (!key || !(key in replacements)) return line;
    seen.add(key);
    return `${key}=${serializeEnvValue(replacements[key] ?? "")}`;
  });
  const missing = Object.keys(replacements).filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`Template .env.example is missing keys: ${missing.join(", ")}`);
  return lines.join("\n");
}
function uriComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function databaseUrl(answers: ProjectAnswers, docker = false): string {
  const host = docker ? "postgres" : answers.dbHost.includes(":") ? `[${answers.dbHost}]` : answers.dbHost;
  const port = docker ? 5432 : answers.dbPort;
  return `postgresql://${uriComponent(answers.dbUser)}:${uriComponent(answers.dbPassword)}@${host}:${port}/${uriComponent(answers.dbName)}?sslmode=disable`;
}
export function npgsqlConnection(answers: ProjectAnswers, docker = false): string {
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  return `Host=${quote(docker ? "postgres" : answers.dbHost)};Port=${docker ? 5432 : answers.dbPort};Database=${quote(answers.dbName)};Username=${quote(answers.dbUser)};Password=${quote(answers.dbPassword)}`;
}
export function composeProfiles(answers: ProjectAnswers): string {
  const descriptor = templateRegistry[answers.templateId];
  return [answers.enableRedis ? "redis" : "", usesLocalStorage(answers) ? descriptor.storageProfile : ""].filter(Boolean).join(",");
}
export function commonEnv(answers: ProjectAnswers): Record<string, string> {
  const descriptor = templateRegistry[answers.templateId];
  return {
    PORT: String(answers.appPort), APP_PORT: String(answers.appPort), POSTGRES_PORT: String(answers.dbPort),
    POSTGRES_DB: answers.dbName, POSTGRES_USER: answers.dbUser, POSTGRES_PASSWORD: answers.dbPassword,
    DATABASE_URL: databaseUrl(answers), DATABASE_URL_DOCKER: databaseUrl(answers, true),
    JWT_SECRET: randomBytes(48).toString("hex"), ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    CACHE_ENABLED: String(answers.enableRedis), RATE_LIMIT_STORE: answers.enableRedis ? "redis" : "memory",
    REDIS_URL: `redis://127.0.0.1:${descriptor.redisPort}`, REDIS_PORT: String(descriptor.redisPort),
    REDIS_NAMESPACE: answers.deploymentName,
    COMPOSE_PROFILES: composeProfiles(answers), COMPOSE_PROJECT_NAME: answers.deploymentName,
    UPLOAD_STORAGE: answers.uploadStorage, S3_ENDPOINT: answers.s3Endpoint, S3_ENDPOINT_DOCKER: answers.s3DockerEndpoint,
    S3_REGION: answers.s3Region, S3_BUCKET: answers.s3Bucket, S3_ACCESS_KEY_ID: answers.s3AccessKey, S3_SECRET_ACCESS_KEY: answers.s3SecretKey,
  };
}
