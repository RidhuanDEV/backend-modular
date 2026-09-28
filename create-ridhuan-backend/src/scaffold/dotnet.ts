import { randomBytes } from "node:crypto";
import { cp, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";

const originalDotnetPrefix = "ModularBackend";

function sanitizeCsharpIdentifier(rawName: string): string {
  const cleaned = rawName.replace(/[^A-Za-z0-9_]/g, "");
  if (cleaned.length === 0) {
    return "MyBackend";
  }
  const first = cleaned.charAt(0);
  if (first >= "0" && first <= "9") {
    return `App${cleaned}`;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function renameDotnetEntries(dir: string, oldPrefix: string, newPrefix: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const originalPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await renameDotnetEntries(originalPath, oldPrefix, newPrefix);
      if (entry.name.includes(oldPrefix)) {
        const renamedDirName = entry.name.replaceAll(oldPrefix, newPrefix);
        const renamedPath = join(dir, renamedDirName);
        await rename(originalPath, renamedPath);
      }
    } else if (entry.isFile()) {
      if (entry.name.includes(oldPrefix)) {
        const renamedFileName = entry.name.replaceAll(oldPrefix, newPrefix);
        const renamedPath = join(dir, renamedFileName);
        await rename(originalPath, renamedPath);
      }
    }
  }
}

async function replaceDotnetInTextFiles(dir: string, oldPrefix: string, newPrefix: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const name = entry.name;
    if (
      name.endsWith(".cs") ||
      name.endsWith(".csproj") ||
      name.endsWith(".slnx") ||
      name.endsWith(".props") ||
      name.endsWith(".json") ||
      name.endsWith(".yaml") ||
      name.endsWith(".yml") ||
      name.endsWith(".md") ||
      name.endsWith(".sh") ||
      name.endsWith(".ps1") ||
      name === "Dockerfile" ||
      name === ".env.example"
    ) {
      const fullPath = join(entry.parentPath, entry.name);
      const content = await readFile(fullPath, "utf8");
      if (content.includes(oldPrefix)) {
        const updated = content.replaceAll(oldPrefix, newPrefix);
        await writeFile(fullPath, updated, "utf8");
      }
    }
  }
}

export async function scaffoldDotnet(
  templateSourceDir: string,
  answers: ProjectAnswers,
): Promise<ScaffoldResult> {
  const target = answers.targetDirectory;

  await cp(templateSourceDir, target, {
    recursive: true,
  });

  const csharpName = sanitizeCsharpIdentifier(answers.projectName);
  const deploymentName = answers.projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  await replaceDotnetInTextFiles(target, originalDotnetPrefix, csharpName);
  await renameDotnetEntries(target, originalDotnetPrefix, csharpName);

  const envExamplePath = join(target, ".env.example");
  const envExample = await readFile(envExamplePath, "utf8");

  const dbPassword = answers.dbPassword;
  const jwtSecret = randomBytes(32).toString("hex");
  const bootstrapPassword = randomBytes(24).toString("hex");
  const s3Secret = randomBytes(24).toString("hex");

  let env = envExample
    .replaceAll("CHANGE_ME_DATABASE_PASSWORD", dbPassword)
    .replaceAll("CHANGE_ME_GENERATE_AT_LEAST_32_RANDOM_BYTES", jwtSecret)
    .replaceAll("CHANGE_ME_BOOTSTRAP_PASSWORD", bootstrapPassword)
    .replaceAll("CHANGE_ME_S3_ACCESS_KEY", "development")
    .replaceAll("CHANGE_ME_S3_SECRET_KEY", s3Secret)
    .replaceAll("Database=modular_net;", `Database=${answers.dbName};`)
    .replaceAll("POSTGRES_DB=modular_net", `POSTGRES_DB=${answers.dbName}`)
    .replaceAll("POSTGRES_USER=modular_net", `POSTGRES_USER=${answers.dbUser}`)
    .replaceAll("Username=modular_net;", `Username=${answers.dbUser};`)
    .replaceAll("APP_PORT=5080", `APP_PORT=${answers.appPort}`)
    .replaceAll("ASPNETCORE_URLS=http://localhost:5080", `ASPNETCORE_URLS=http://localhost:${answers.appPort}`)
    .replaceAll("Rate__Store=memory", `Rate__Store=${answers.enableRedis ? "redis" : "memory"}`)
    .replaceAll("Cache__Enabled=false", `Cache__Enabled=${answers.enableRedis ? "true" : "false"}`)
    .replaceAll("Upload__Storage=local", `Upload__Storage=${answers.uploadStorage}`)
    .replaceAll("Upload__Endpoint=http://127.0.0.1:19000", `Upload__Endpoint=${answers.s3Endpoint}`)
    .replaceAll("Upload__Bucket=uploads", `Upload__Bucket=${answers.s3Bucket}`)
    .replaceAll("Cache__Prefix=modular-net:v1", `Cache__Prefix=${deploymentName}:v1`)
    .replaceAll("Rate__Prefix=modular-net:v1", `Rate__Prefix=${deploymentName}:v1`);

  const activeProfiles: string[] = [];
  if (answers.enableRedis) {
    activeProfiles.push("redis");
  }
  if (answers.uploadStorage === "s3") {
    activeProfiles.push("s3");
  }
  env = env.replaceAll("COMPOSE_PROFILES=", `COMPOSE_PROFILES=${activeProfiles.join(",")}`);

  await writeFile(join(target, ".env"), env, "utf8");

  const composePath = join(target, "compose.yaml");
  const composeContent = await readFile(composePath, "utf8");
  const updatedCompose = composeContent.replace("name: modular-net", `name: ${deploymentName}`);
  await writeFile(composePath, updatedCompose, "utf8");

  const instructions: readonly string[] = [
    `cd ${answers.projectName}`,
    `# Pastikan database '${answers.dbName}' sudah dibuat di PostgreSQL:`,
    `psql -U ${answers.dbUser} -c "CREATE DATABASE ${answers.dbName};"`,
    "dotnet restore",
    "docker compose up -d",
    `dotnet run --project src/${csharpName}.Api`,
  ];

  return {
    projectDirectory: target,
    templateId: answers.templateId,
    instructions,
  };
}
