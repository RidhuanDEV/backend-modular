import { randomBytes } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";

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

function updatePackageJsonContent(rawContent: string, projectName: string): string {
  let result = rawContent.replace(/"name"\s*:\s*"[^"]*"/, `"name": "${projectName}"`);
  if (!result.includes('"private"')) {
    result = result.replace(/\{\s*\r?\n/, '{\n  "private": true,\n');
  }
  return result;
}

export async function scaffoldExpress(
  templateSourceDir: string,
  answers: ProjectAnswers,
): Promise<ScaffoldResult> {
  const target = answers.targetDirectory;

  await cp(templateSourceDir, target, {
    recursive: true,
  });

  const packageJsonPath = join(target, "package.json");
  const packageRaw = await readFile(packageJsonPath, "utf8");
  const updatedPackageJson = updatePackageJsonContent(packageRaw, answers.projectName);
  await writeFile(packageJsonPath, updatedPackageJson, "utf8");

  const envExamplePath = join(target, ".env.example");
  const envExample = await readFile(envExamplePath, "utf8");

  const jwtSecret = randomBytes(32).toString("hex");
  const s3Secret = randomBytes(24).toString("hex");

  const envReplacements: Record<string, string> = {
    APP_PORT: String(answers.appPort),
    POSTGRES_DB: answers.dbName,
    POSTGRES_USER: answers.dbUser,
    POSTGRES_PASSWORD: answers.dbPassword,
    DATABASE_URL: `postgresql://${answers.dbUser}:${answers.dbPassword}@localhost:5432/${answers.dbName}?schema=public`,
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
    `# Pastikan database '${answers.dbName}' sudah dibuat di PostgreSQL:`,
    `psql -U ${answers.dbUser} -c "CREATE DATABASE ${answers.dbName};"`,
    "npm install",
    "npx prisma generate",
    "npx prisma migrate dev",
    "npm run seed",
    "npm run dev",
  ];

  return {
    projectDirectory: target,
    templateId: answers.templateId,
    instructions,
  };
}
