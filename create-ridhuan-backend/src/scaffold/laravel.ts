import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { objectRecord, templateRegistry } from "../templates.js";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { composeProfiles, databaseEnv, environmentFile, replaceEnv } from "./env.js";
import { copyTemplate } from "./files.js";

export async function scaffoldLaravel(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const descriptor = templateRegistry[answers.templateId];
  const name = answers.packageName.replace(/[^a-z0-9-]/g, "-");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Invalid Composer project identity");
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), {
    APP_NAME: answers.projectName, APP_URL: `http://localhost:${answers.appPort}`,
    PORT: String(answers.appPort), APP_PORT: String(answers.appPort),
    APP_KEY: `base64:${randomBytes(32).toString("base64")}`, JWT_SECRET: randomBytes(48).toString("hex"),
    JWT_ISSUER: answers.deploymentName, JWT_AUDIENCE: answers.deploymentName,
    ADMIN_PASSWORD: randomBytes(24).toString("base64url"), DB_PROVIDER: answers.databaseProvider,
    DB_HOST: answers.dbHost, DB_PORT: String(answers.dbPort), DB_DATABASE: answers.dbName,
    DB_USERNAME: answers.dbUser, DB_PASSWORD: answers.dbPassword, ...databaseEnv(answers),
    CACHE_ENABLED: String(answers.enableRedis), RATE_LIMIT_STORE: answers.enableRedis ? "redis" : "file",
    REDIS_HOST: "127.0.0.1", REDIS_PORT: String(descriptor.redisPort), REDIS_NAMESPACE: answers.deploymentName,
    COMPOSE_PROFILES: composeProfiles(answers), COMPOSE_PROJECT_NAME: answers.deploymentName,
    UPLOAD_STORAGE: answers.uploadStorage, S3_ENDPOINT: answers.s3Endpoint, S3_ENDPOINT_DOCKER: answers.s3DockerEndpoint,
    S3_REGION: answers.s3Region, S3_BUCKET: answers.s3Bucket, S3_ACCESS_KEY_ID: answers.s3AccessKey,
    S3_PREFIX: answers.deploymentName,
    S3_SECRET_ACCESS_KEY: answers.s3SecretKey,
  });
  await copyTemplate(source, answers);
  const path = join(answers.targetDirectory, "composer.json");
  const metadata = objectRecord(JSON.parse(await readFile(path, "utf8")), "Composer project");
  metadata.name = `app/${name}`;
  await writeFile(path, `${JSON.stringify(metadata, null, 4)}\n`);
  // Composer's content hash excludes project name: the dependency lock stays intact.
  for (const directory of ["bootstrap/cache", "storage/app/private/uploads", "storage/framework/cache/data", "storage/framework/cache/locks", "storage/framework/sessions", "storage/framework/views", "storage/logs"]) {
    await mkdir(join(answers.targetDirectory, directory), { recursive: true });
  }
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "laravel" };
}
