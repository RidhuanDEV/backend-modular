import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, rename, readdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { copyTemplate } from "./files.js";
import { replaceEnv, databaseEnv, composeProfiles, environmentFile } from "./env.js";

export const javaKeywords = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum exports extends final finally float for goto if implements import instanceof int interface long module native new non-sealed open opens package permits private protected provides public record requires return sealed short static strictfp super switch synchronized this throw throws to transient transitive try uses var void volatile while with yield true false null _".split(" "));
export function validateJavaPackage(value: string): void {
  const parts = value.split(".");
  if (parts.length < 2 || parts.some(part => !/^[a-z][a-z0-9_]*$/.test(part) || javaKeywords.has(part))) throw new Error("Java package requires lowercase identifiers, at least two segments, and no Java keyword");
}
export function defaultJavaPackage(name: string): string {
  let segment = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z]/.test(segment) || javaKeywords.has(segment)) segment = "app_" + segment;
  return "com.example." + segment;
}
async function renameJava(root: string, namespace: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await renameJava(path, namespace);
    else if (entry.name.endsWith(".java") || entry.name.endsWith(".java.txt")) {
      const contents = await readFile(path, "utf8");
      await writeFile(path, contents.replaceAll("com.example.backend", namespace));
    }
  }
}
export async function scaffoldSpringboot(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  validateJavaPackage(answers.javaPackage);
  await copyTemplate(source, answers);
  if (process.platform !== "win32") await chmod(join(answers.targetDirectory, "mvnw"), 0o755);
  for (const scope of ["main", "test"]) {
    const base = join(answers.targetDirectory, "src", scope, "java");
    await renameJava(base, answers.javaPackage);
    const original = join(base, "com", "example", "backend");
    const renamed = join(base, ...answers.javaPackage.split("."));
    await mkdir(join(renamed, ".."), { recursive: true });
    if (original !== renamed) await rename(original, renamed);
  }
  await renameJava(join(answers.targetDirectory, "src", "main", "resources", "templates"), answers.javaPackage);
  const pom = join(answers.targetDirectory, "pom.xml");
  const pomText = await readFile(pom, "utf8");
  await writeFile(pom, pomText.replace("<artifactId>modular-springboot</artifactId>", "<artifactId>" + answers.packageName + "</artifactId>")
    .replace("<name>modular-springboot</name>", "<name>" + answers.packageName + "</name>")
    .replace("<groupId>com.example</groupId>", "<groupId>" + answers.javaPackage.split(".").slice(0, -1).join(".") + "</groupId>")
    .replace("<mainClass>com.example.backend.BackendApplication</mainClass>", "<mainClass>" + answers.javaPackage + ".BackendApplication</mainClass>"));
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), {
    PORT: String(answers.appPort), APP_PORT: String(answers.appPort), APP_NAME: answers.packageName,
    DB_PROVIDER: answers.databaseProvider, DB_HOST: answers.dbHost, DB_PORT: String(answers.dbPort),
    DB_NAME: answers.dbName, DB_USER: answers.dbUser, DB_PASSWORD: answers.dbPassword,
    ...databaseEnv(answers), JWT_SECRET: randomBytes(48).toString("hex"), ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    JWT_ISSUER: answers.packageName, JWT_AUDIENCE: answers.packageName, CACHE_ENABLED: String(answers.enableRedis),
    RATE_LIMIT_STORE: answers.enableRedis ? "redis" : "memory", REDIS_URL: "redis://127.0.0.1:6379",
    REDIS_NAMESPACE: answers.deploymentName, COMPOSE_PROJECT_NAME: answers.deploymentName, COMPOSE_PROFILES: composeProfiles(answers),
    UPLOAD_STORAGE: answers.uploadStorage, S3_ENDPOINT: answers.s3Endpoint, S3_ENDPOINT_DOCKER: answers.s3DockerEndpoint,
    S3_REGION: answers.s3Region, S3_BUCKET: answers.s3Bucket, S3_PREFIX: answers.deploymentName, S3_ACCESS_KEY_ID: answers.s3AccessKey, S3_SECRET_ACCESS_KEY: answers.s3SecretKey,
  });
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "springboot" };
}
