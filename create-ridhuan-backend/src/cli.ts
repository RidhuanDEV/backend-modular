import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectPrompt } from "./prompts/select.js";
import { textPrompt } from "./prompts/text.js";
import { colors, symbols } from "./prompts/terminal-theme.js";
import { scaffoldExpress } from "./scaffold/express.js";
import { scaffoldGolang } from "./scaffold/golang.js";
import { scaffoldDotnet } from "./scaffold/dotnet.js";
import type {
  CliArguments,
  PromptOption,
  ProjectAnswers,
  ScaffoldResult,
  TemplateId,
  UploadStorageType,
} from "./types.js";

const templateOptions: readonly PromptOption<TemplateId>[] = [
  {
    label: "Express TypeScript",
    value: "express-typescript",
    hint: "Prisma, Zod, JWT, RBAC, PostgreSQL",
  },
  {
    label: "Golang",
    value: "golang",
    hint: "Chi, Huma, sqlc, JWT, PostgreSQL",
  },
  {
    label: ".NET 10",
    value: "dotnet",
    hint: "ASP.NET Core, EF Core / Npgsql, JWT, PostgreSQL",
  },
];

function parseCliArgs(args: readonly string[]): CliArguments {
  let projectName: string | undefined = undefined;
  let template: TemplateId | undefined = undefined;
  let yes: boolean = false;
  let noInstall: boolean = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--no-install") {
      noInstall = true;
    } else if (arg === "--template" || arg === "-t") {
      const next = args[i + 1];
      if (next === "express-typescript" || next === "express" || next === "ts") {
        template = "express-typescript";
        i++;
      } else if (next === "golang" || next === "go") {
        template = "golang";
        i++;
      } else if (next === "dotnet" || next === "net" || next === "csharp") {
        template = "dotnet";
        i++;
      }
    } else if (!arg.startsWith("-") && projectName === undefined) {
      projectName = arg;
    }
  }

  return {
    projectName,
    template,
    yes,
    noInstall,
  };
}

function resolveTemplatesRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = resolve(currentFile, "..");
  return resolve(currentDir, "../templates");
}

function sanitizeProjectName(value: string, template: TemplateId): string {
  if (template === "dotnet") {
    const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "");
    return cleaned.length > 0 ? cleaned : "MyBackend";
  }
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return normalized.length > 0 ? normalized : "my-backend";
}

function sanitizeDbIdentifier(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "backend_db";
}

function verifyEmptyDirectory(targetPath: string): void {
  if (existsSync(targetPath)) {
    const files = readdirSync(targetPath);
    if (files.length > 0) {
      throw new Error(`Target directory is not empty: ${targetPath}`);
    }
  }
}

export async function runCli(): Promise<void> {
  process.stdout.write(
    `\n${colors.brightCyan}${colors.bold}create-ridhuan-backend${colors.reset} ${colors.dim}v1.0.0${colors.reset}\n`,
  );
  process.stdout.write(`${colors.gray}Modular backend starter generator${colors.reset}\n\n`);

  const cliArgs = parseCliArgs(process.argv.slice(2));

  let chosenTemplate: TemplateId;
  if (cliArgs.template !== undefined) {
    chosenTemplate = cliArgs.template;
    process.stdout.write(
      `${colors.green}${symbols.check}${colors.reset} ${colors.bold}Template:${colors.reset} ${colors.brightCyan}${chosenTemplate}${colors.reset}\n`,
    );
  } else {
    chosenTemplate = await selectPrompt<TemplateId>(
      "Select a backend framework / template:",
      templateOptions,
      0,
    );
  }

  const defaultDir = cliArgs.projectName !== undefined ? cliArgs.projectName : chosenTemplate === "dotnet" ? "MyBackend" : "my-backend";
  const rawProjectName = await textPrompt("Project name", defaultDir, cliArgs.yes);
  const projectName = sanitizeProjectName(rawProjectName, chosenTemplate);
  const targetDirectory = resolve(process.cwd(), projectName);

  verifyEmptyDirectory(targetDirectory);

  let defaultPort: number = 3000;
  if (chosenTemplate === "dotnet") {
    defaultPort = 5080;
  }

  const portStr = await textPrompt("HTTP Port", String(defaultPort), cliArgs.yes);
  const appPort = Number.parseInt(portStr, 10) || defaultPort;

  const defaultDb = sanitizeDbIdentifier(projectName);
  const dbName = await textPrompt("PostgreSQL database name", defaultDb, cliArgs.yes);
  const dbUser = await textPrompt("PostgreSQL username", defaultDb, cliArgs.yes);
  const generatedPassword = randomBytes(16).toString("hex");
  const dbPassword = await textPrompt("PostgreSQL password", generatedPassword, cliArgs.yes);

  const redisOptions: readonly PromptOption<boolean>[] = [
    { label: "No", value: false, hint: "In-memory rate limiting and no cache" },
    { label: "Yes", value: true, hint: "Redis cache & distributed rate limit" },
  ];

  let enableRedis: boolean = false;
  if (cliArgs.yes) {
    enableRedis = false;
  } else {
    enableRedis = await selectPrompt<boolean>(
      "Enable Redis cache and distributed rate limiting?",
      redisOptions,
      0,
    );
  }

  const storageOptions: readonly PromptOption<UploadStorageType>[] = [
    { label: "Local filesystem", value: "local", hint: "Store uploads on disk" },
    { label: "S3 / MinIO", value: "s3", hint: "Store uploads in S3-compatible bucket" },
  ];

  let uploadStorage: UploadStorageType = "local";
  if (cliArgs.yes) {
    uploadStorage = "local";
  } else {
    uploadStorage = await selectPrompt<UploadStorageType>(
      "Upload storage provider:",
      storageOptions,
      0,
    );
  }

  let goModulePath: string | undefined = undefined;
  if (chosenTemplate === "golang") {
    goModulePath = await textPrompt(
      "Go module path",
      `example.com/${projectName}`,
      cliArgs.yes,
    );
  }

  const answers: ProjectAnswers = {
    targetDirectory,
    projectName,
    templateId: chosenTemplate,
    appPort,
    dbName,
    dbUser,
    dbPassword,
    enableRedis,
    uploadStorage,
    s3Endpoint: "http://localhost:9000",
    s3DockerEndpoint: "http://minio:9000",
    s3Region: "us-east-1",
    s3Bucket: "uploads",
    s3AccessKey: "minioadmin",
    s3SecretKey: "",
    goModulePath,
  };

  const templatesRoot = resolveTemplatesRoot();
  const sourceTemplateDir = join(templatesRoot, chosenTemplate);

  process.stdout.write(
    `\n${colors.brightCyan}${symbols.info}${colors.reset} Scaffolding ${colors.bold}${projectName}${colors.reset} from ${colors.cyan}${chosenTemplate}${colors.reset}...\n`,
  );

  let result: ScaffoldResult;
  if (chosenTemplate === "express-typescript") {
    result = await scaffoldExpress(sourceTemplateDir, answers);
  } else if (chosenTemplate === "golang") {
    result = await scaffoldGolang(sourceTemplateDir, answers);
  } else {
    result = await scaffoldDotnet(sourceTemplateDir, answers);
  }

  process.stdout.write(
    `\n${colors.brightGreen}${symbols.check}${colors.reset} ${colors.bold}Successfully created ${projectName}!${colors.reset}\n\n`,
  );
  process.stdout.write(`${colors.bold}Next steps:${colors.reset}\n`);

  for (const step of result.instructions) {
    process.stdout.write(`  ${colors.brightCyan}${step}${colors.reset}\n`);
  }

  process.stdout.write("\n");
}
