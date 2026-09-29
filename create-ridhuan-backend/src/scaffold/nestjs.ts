import { randomBytes } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { assertEnvKeysExist } from "./env.js";

function replaceEnv(template: string, replacements: Readonly<Record<string, string>>): string {
  return template.split(/\r?\n/).map((line) => {
    const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
    return key && key in replacements ? `${key}=${replacements[key] ?? ""}` : line;
  }).join("\n");
}

export async function scaffoldNestjs(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const target = answers.targetDirectory;
  await cp(source, target, { recursive: true });
  const packagePath = join(target, "package.json");
  const packageJson: unknown = JSON.parse(await readFile(packagePath, "utf8"));
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) throw new Error("Invalid template package.json");
  const packageRecord = packageJson as Record<string, unknown>;
  packageRecord.name = answers.projectName;
  packageRecord.private = true;
  await writeFile(packagePath, `${JSON.stringify(packageRecord, null, 2)}\n`);
  const lockPath = join(target, "package-lock.json");
  const lockJson: unknown = JSON.parse(await readFile(lockPath, "utf8"));
  if (!lockJson || typeof lockJson !== "object" || Array.isArray(lockJson)) throw new Error("Invalid template package-lock.json");
  const lockRecord = lockJson as Record<string, unknown>;
  lockRecord.name = answers.projectName;
  const packages = lockRecord.packages;
  if (packages && typeof packages === "object" && !Array.isArray(packages)) {
    const root = (packages as Record<string, unknown>)[""];
    if (root && typeof root === "object" && !Array.isArray(root)) (root as Record<string, unknown>).name = answers.projectName;
  }
  await writeFile(lockPath, `${JSON.stringify(lockRecord, null, 2)}\n`);

  const password = answers.dbPassword;
  if (/[\r\n]/.test(password)) throw new Error("Database password cannot contain a newline");
  const databaseUrl = `postgresql://${encodeURIComponent(answers.dbUser)}:${encodeURIComponent(password)}@localhost:5432/${encodeURIComponent(answers.dbName)}?schema=public`;
  const dockerUrl = `postgresql://${encodeURIComponent(answers.dbUser)}:${encodeURIComponent(password)}@postgres:5432/${encodeURIComponent(answers.dbName)}?schema=public`;
  const envExample = await readFile(join(target, ".env.example"), "utf8");
  const replacements: Record<string, string> = {
    PORT: String(answers.appPort), APP_PORT: String(answers.appPort), DATABASE_URL: databaseUrl,
    DATABASE_URL_DOCKER: dockerUrl, POSTGRES_DB: answers.dbName, POSTGRES_USER: answers.dbUser,
    POSTGRES_PASSWORD: password, JWT_SECRET: randomBytes(48).toString("hex"),
    ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    CACHE_ENABLED: answers.enableRedis ? "true" : "false", RATE_LIMIT_STORE: answers.enableRedis ? "redis" : "memory",
    REDIS_URL_DOCKER: "redis://redis:6379", REDIS_NAMESPACE: answers.projectName,
    UPLOAD_STORAGE: answers.uploadStorage,
    S3_ENDPOINT: answers.s3Endpoint,
    S3_ENDPOINT_DOCKER: answers.s3Endpoint.includes("localhost") ? "http://minio:9000" : answers.s3Endpoint,
    S3_REGION: answers.s3Region,
    S3_BUCKET: answers.s3Bucket, S3_ACCESS_KEY_ID: answers.s3AccessKey,
    S3_SECRET_ACCESS_KEY: answers.s3SecretKey || randomBytes(24).toString("hex"),
  };
  assertEnvKeysExist(envExample, replacements);
  await writeFile(join(target, ".env"), replaceEnv(envExample, replacements));
  return {
    projectDirectory: target, templateId: "nestjs",
    instructions: [
      `cd ${answers.projectName}`,
      "# Requires Node.js >=24.15, PostgreSQL 18 and an edited .env",
      "npm run prisma:migrate:deploy",
      "npm run build",
      "npm run seed",
      "npm start",
      "# Or start the stack with Docker Compose:",
      `docker compose ${answers.enableRedis ? "--profile redis " : ""}${answers.uploadStorage === "s3" ? "--profile s3 " : ""}up -d --build`,
    ],
  };
}
