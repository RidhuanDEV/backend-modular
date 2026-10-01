import { randomBytes } from "node:crypto";
import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { composeProfiles, databaseEnv, environmentFile, npgsqlConnection, replaceEnv } from "./env.js";
import { copyTemplate, transformText } from "./files.js";
import { templateRegistry } from "../templates.js";
async function renameEntries(dir: string, oldPrefix: string, newPrefix: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await renameEntries(path, oldPrefix, newPrefix);
    if (entry.name.includes(oldPrefix)) await rename(path, join(dir, entry.name.replaceAll(oldPrefix, newPrefix)));
  }
}
export async function scaffoldDotnet(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), {
    APP_PORT: String(answers.appPort), ASPNETCORE_URLS: `http://localhost:${answers.appPort}`,
    ...databaseEnv(answers), Database__Provider: answers.databaseProvider,
    Database__ConnectionString: npgsqlConnection(answers), Database__ConnectionString_DOCKER: npgsqlConnection(answers, true),
    Jwt__Secret: randomBytes(48).toString("hex"), Bootstrap__Password: randomBytes(24).toString("base64url"),
    Rate__Store: answers.enableRedis ? "redis" : "memory", Cache__Enabled: String(answers.enableRedis),
    Rate__Prefix: `${answers.deploymentName}:v1`, Cache__Prefix: `${answers.deploymentName}:v1`,
    Redis__ConnectionString: "127.0.0.1:56379", REDIS_PORT: "56379", Upload__Storage: answers.uploadStorage,
    Upload__Endpoint: answers.s3Endpoint, S3_ENDPOINT_DOCKER: answers.s3DockerEndpoint,
    Upload__Region: answers.s3Region, Upload__Bucket: answers.s3Bucket,
    Upload__AccessKey: answers.s3AccessKey, Upload__SecretKey: answers.s3SecretKey,
    S3_PORT: "19000", Telemetry__ServiceName: answers.deploymentName,
    COMPOSE_PROFILES: composeProfiles(answers), COMPOSE_PROJECT_NAME: answers.deploymentName,
  });
  const manifest = await copyTemplate(source, answers);
  await transformText(answers.targetDirectory, (content, name) => {
    if (name === "template-manifest.json") return content;
    const updated = content.replaceAll(manifest.identity, answers.namespace)
      .replaceAll(manifest.identity.toLowerCase(), answers.namespace.toLowerCase());
    return name === "launchSettings.json" ? updated.replaceAll(`localhost:${templateRegistry.dotnet.defaultPort}`, `localhost:${answers.appPort}`) : updated;
  });
  await renameEntries(answers.targetDirectory, manifest.identity, answers.namespace);
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "dotnet" };
}
