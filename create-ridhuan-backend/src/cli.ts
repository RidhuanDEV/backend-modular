import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import passwordPrompt from "@inquirer/password";
import { parseCliArgs, parsePort, validateProjectName, validateGoModule, helpText } from "./arguments.js";
import { selectPrompt } from "./prompts/select.js";
import { textPrompt } from "./prompts/text.js";
import { verifyDatabaseConnection } from "./prompts/db-check.js";
import { scaffoldExpress } from "./scaffold/express.js";
import { scaffoldNestjs } from "./scaffold/nestjs.js";
import { scaffoldGolang } from "./scaffold/golang.js";
import { scaffoldDotnet } from "./scaffold/dotnet.js";
import { scaffoldFastapi } from "./scaffold/fastapi.js";
import { objectRecord, readManifest, templateRegistry } from "./templates.js";
import { command, preflight, installDependencies } from "./process.js";
import { gettingStarted, nextSteps } from "./instructions.js";
import { serializeEnvValue } from "./scaffold/env.js";
import type { DatabaseProvider, ProjectAnswers, SetupMode, UploadStorageType, TemplateId } from "./types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function secret(label: string, supplied: string | undefined, auto: boolean): Promise<string> {
  if (supplied !== undefined) return supplied;
  if (auto) return randomBytes(24).toString("base64url");
  const entered = await passwordPrompt({ message: `${label} (empty generates a new secret)`, mask: "*" });
  return entered || randomBytes(24).toString("base64url");
}
function emptyTarget(target: string): void {
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Project target must not be a symlink or junction");
  if (existsSync(target) && (!lstatSync(target).isDirectory() || readdirSync(target).length > 0)) throw new Error(`Target must be an empty directory: ${target}`);
}
function validateAnswers(answers: ProjectAnswers): void {
  if (answers.databaseProvider === "mysql" && answers.dbUser.toLowerCase() === "root") throw new Error("Use a dedicated MySQL application user; root is reserved for database administration.");
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(answers.dbName) || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(answers.dbUser)) throw new Error("Database name/user must be SQL identifiers (maximum 63 characters)");
  if (!isIP(answers.dbHost) && !/^(?=.{1,253}$)[A-Za-z0-9]+(?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(answers.dbHost)) throw new Error("Invalid database host");
  for (const endpoint of [answers.s3Endpoint, answers.s3DockerEndpoint]) {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("S3 endpoint must be an HTTP(S) URL without credentials");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(answers.s3Bucket)) throw new Error("Invalid S3 bucket name");
  if (!answers.dbPassword || (answers.uploadStorage === "s3" && (!answers.s3AccessKey || !answers.s3SecretKey || !answers.s3Region))) throw new Error("Database password and enabled S3 credentials must not be empty");
  for (const value of Object.values(answers)) if (typeof value === "string") serializeEnvValue(value);
  if (answers.goModulePath) validateGoModule(answers.goModulePath);
}

export async function runCli(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const metadata: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = objectRecord(metadata, "package metadata").version;
  if (typeof version !== "string") throw new Error("Missing CLI version");
  if (args.help) { process.stdout.write(helpText); return; }
  if (args.version) { process.stdout.write(`${version}\n`); return; }
  const automatic = args.yes || !process.stdin.isTTY;
  process.stdout.write(`\ncreate-ridhuan-backend v${version}\n\n`);
  const template: TemplateId = args.template ?? (automatic ? "express-typescript" : await selectPrompt("Backend framework", Object.values(templateRegistry).map((item) => ({ label: item.label, value: item.id, hint: item.hint }))));
  const descriptor = templateRegistry[template];
  const source = join(root, "templates", template);
  const manifest = await readManifest(source, template);
  const databaseProvider: DatabaseProvider = args.database ?? (automatic ? "postgresql" : await selectPrompt<DatabaseProvider>("Database engine", [
    { label: "PostgreSQL", value: "postgresql", hint: "Default" }, { label: "MySQL 8.4 LTS", value: "mysql" },
  ]));
  const databaseLabel = databaseProvider === "mysql" ? "MySQL" : "PostgreSQL";
  if (!manifest.databaseProviders.includes(databaseProvider)) throw new Error(`${descriptor.label} snapshot does not support ${databaseProvider}.`);
  const mode: SetupMode = args.mode ?? (automatic ? "manual" : await selectPrompt<SetupMode>("Setup mode", [
    { label: "Manual", value: "manual", hint: "Install dependencies using host tools" },
    { label: "Docker", value: "docker", hint: "Build and run with Compose" },
  ]));
  const projectName = args.projectName ?? await textPrompt("Project folder", template === "dotnet" ? "MyBackend" : "my-backend", automatic);
  validateProjectName(projectName);
  const targetDirectory = resolve(realpathSync(process.cwd()), projectName);
  emptyTarget(targetDirectory);
  const appPort = args.port ?? parsePort(await textPrompt("HTTP port", String(descriptor.defaultPort), automatic), "HTTP port");
  const dbHost = args.dbHost ?? await textPrompt(`${databaseLabel} host for manual startup`, "127.0.0.1", automatic);
  const dbPort = args.dbPort ?? parsePort(await textPrompt(`${databaseLabel} host port`, String(databaseProvider === "mysql" ? 3306 : descriptor.dbPort), automatic), "Database port");
  const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/-+$/, "");
  const dbDefault = slug.replace(/-/g, "_");
  const dbName = args.dbName ?? await textPrompt(`${databaseLabel} database`, /^\d/.test(dbDefault) ? `app_${dbDefault}` : dbDefault, automatic);
  const dbUser = args.dbUser ?? await textPrompt(`${databaseLabel} username`, databaseProvider === "mysql" ? "backend" : "postgres", automatic);
  const dbPassword = await secret(`${databaseLabel} password`, process.env.RIDHUAN_DB_PASSWORD, automatic);
  const enableRedis = args.redis ?? (automatic ? false : await selectPrompt<boolean>("Redis cache and shared rate limiter", [
    { label: "Disabled", value: false }, { label: "Enabled", value: true },
  ]));
  const uploadStorage: UploadStorageType = args.storage ?? (automatic ? "local" : await selectPrompt<UploadStorageType>("Upload storage", [
    { label: "Local files", value: "local" }, { label: "S3 compatible", value: "s3" },
  ]));
  const s3Endpoint = args.s3Endpoint ?? (uploadStorage === "s3" ? await textPrompt("S3 endpoint for manual startup", `http://127.0.0.1:${descriptor.storagePort}`, automatic) : `http://127.0.0.1:${descriptor.storagePort}`);
  const selectedS3 = new URL(s3Endpoint);
  const isDefaultFixture = selectedS3.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(selectedS3.hostname) &&
    selectedS3.port === String(descriptor.storagePort) && selectedS3.pathname === "/" && !selectedS3.search && !selectedS3.hash;
  const s3DockerDefault = isDefaultFixture ? `http://${descriptor.storageHost}` : s3Endpoint;
  const s3DockerEndpoint = args.s3DockerEndpoint ?? await textPrompt("S3 endpoint inside Compose", s3DockerDefault, automatic || uploadStorage !== "s3");
  const namespaceParts = projectName.split(/[.-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  const namespace = namespaceParts.join("");
  const answers: ProjectAnswers = {
    databaseProvider,
    targetDirectory, projectName, packageName: slug, namespace: /^\d/.test(namespace) ? `App${namespace}` : namespace,
    deploymentName: `${slug.slice(0, 48)}-${randomBytes(4).toString("hex")}`, templateId: template, mode, appPort,
    dbHost, dbPort, dbName, dbUser, dbPassword, enableRedis, uploadStorage, s3Endpoint, s3DockerEndpoint,
    s3Region: args.s3Region ?? await textPrompt("S3 region", "us-east-1", automatic || uploadStorage !== "s3"),
    s3Bucket: args.s3Bucket ?? await textPrompt("S3 bucket", "uploads", automatic || uploadStorage !== "s3"),
    s3AccessKey: args.s3AccessKey ?? await textPrompt("S3 access key", "development", automatic || uploadStorage !== "s3"),
    s3SecretKey: await secret("S3 secret key", process.env.RIDHUAN_S3_SECRET_KEY, automatic || uploadStorage !== "s3"),
    ...(template === "golang" ? { goModulePath: args.goModule ?? await textPrompt("Go module path", `example.com/${slug}`, automatic) } : {}),
  };
  validateAnswers(answers);
  if (template !== "golang" && args.goModule !== undefined) throw new Error("--go-module is only valid for Go");
  if (!args.noInstall) preflight(answers, manifest);
  if (!automatic && mode === "manual") {
    const check = await verifyDatabaseConnection(databaseProvider, dbHost, dbPort, dbUser, dbPassword, dbName);
    process.stdout.write(`${check.message}\n`);
    if (check.status !== "connected") {
      const proceed = await selectPrompt<boolean>("Database is not ready", [
        { label: "Generate files; configure database before migration", value: true }, { label: "Cancel setup", value: false },
      ]);
      if (!proceed) throw new Error("Setup cancelled before creating files");
    }
  }
  process.stdout.write(`Creating ${projectName}; package ${answers.packageName}; namespace ${answers.namespace}\n`);
  const scaffold = { "express-typescript": scaffoldExpress, nestjs: scaffoldNestjs, golang: scaffoldGolang, dotnet: scaffoldDotnet, fastapi: scaffoldFastapi }[template];
  emptyTarget(targetDirectory);
  await scaffold(source, answers);
  await writeFile(join(targetDirectory, "GETTING-STARTED.md"), gettingStarted(answers, manifest));
  const readmePath = join(targetDirectory, "README.md");
  await writeFile(readmePath, `> Generated project **${projectName}**: start with [GETTING-STARTED.md](GETTING-STARTED.md). API http://localhost:${appPort}.\n\n${await readFile(readmePath, "utf8")}`);
  // Ignore materialization and secret creation precede Git, including when installation fails.
  command("git", ["init"], targetDirectory);
  if (!args.noInstall) installDependencies(answers);
  process.stdout.write(`\nCreated ${projectName}. Next steps:\n${nextSteps(answers, args.noInstall).join("\n")}\n`);
}
