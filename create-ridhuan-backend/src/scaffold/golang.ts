import { randomBytes } from "node:crypto";
import { cp, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";

const originalGoModule = "github.com/RidhuanDEV/golang-backend";

function replaceEnvVariables(templateContent: string, replacements: Record<string, string>): string {
  const lines = templateContent.split(/\r?\n/);
  const resultLines: string[] = [];

  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match !== null && match[1] !== undefined && match[1] in replacements) {
      const key = match[1];
      const val = replacements[key];
      resultLines.push(`${key}=${val !== undefined ? val : ""}`);
    } else {
      resultLines.push(line);
    }
  }

  return resultLines.join("\n");
}

async function replaceModuleInFiles(dir: string, oldModule: string, newModule: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const name = entry.name;
    if (
      name.endsWith(".go") ||
      name === "go.mod" ||
      name === "go.sum" ||
      name.endsWith(".md") ||
      name.endsWith(".yaml") ||
      name.endsWith(".yml") ||
      name.endsWith(".sh") ||
      name.endsWith(".ps1")
    ) {
      const fullPath = join(entry.parentPath, entry.name);
      const content = await readFile(fullPath, "utf8");
      if (content.includes(oldModule)) {
        const updated = content.replaceAll(oldModule, newModule);
        await writeFile(fullPath, updated, "utf8");
      }
    }
  }
}

export async function scaffoldGolang(
  templateSourceDir: string,
  answers: ProjectAnswers,
): Promise<ScaffoldResult> {
  const target = answers.targetDirectory;

  await cp(templateSourceDir, target, {
    recursive: true,
  });

  const modulePath =
    answers.goModulePath !== undefined && answers.goModulePath.length > 0
      ? answers.goModulePath
      : `example.com/${answers.projectName}`;

  await replaceModuleInFiles(target, originalGoModule, modulePath);

  const envExamplePath = join(target, ".env.example");
  const envExample = await readFile(envExamplePath, "utf8");

  const jwtSecret = randomBytes(32).toString("hex");
  const s3Secret = randomBytes(24).toString("hex");

  const envReplacements: Record<string, string> = {
    PORT: String(answers.appPort),
    APP_PORT: String(answers.appPort),
    POSTGRES_DB: answers.dbName,
    POSTGRES_USER: answers.dbUser,
    POSTGRES_PASSWORD: answers.dbPassword,
    DATABASE_URL: `postgres://${answers.dbUser}:${answers.dbPassword}@localhost:5432/${answers.dbName}?sslmode=disable`,
    JWT_SECRET: jwtSecret,
    CACHE_ENABLED: answers.enableRedis ? "true" : "false",
    RATE_LIMIT_STORE: answers.enableRedis ? "redis" : "memory",
    UPLOAD_STORAGE: answers.uploadStorage,
    S3_ENDPOINT: answers.s3Endpoint,
    S3_ENDPOINT_DOCKER: answers.s3DockerEndpoint,
    S3_REGION: answers.s3Region,
    S3_BUCKET: answers.s3Bucket,
    S3_ACCESS_KEY: answers.s3AccessKey,
    S3_SECRET_KEY: answers.s3SecretKey.length > 0 ? answers.s3SecretKey : s3Secret,
  };

  const finalEnv = replaceEnvVariables(envExample, envReplacements);
  await writeFile(join(target, ".env"), finalEnv, "utf8");

  const instructions: readonly string[] = [
    `cd ${answers.projectName}`,
    "# Jalankan instan via Docker (PostgreSQL & migrasi otomatis dibuat):",
    "docker compose up --build -d",
    "",
    "# Atau jika menjalankan manual di host:",
    "go mod tidy",
    "go run ./cmd/api",
  ];

  return {
    projectDirectory: target,
    templateId: answers.templateId,
    instructions,
  };
}
