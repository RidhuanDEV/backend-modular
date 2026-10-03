import { parseArgs } from "node:util";
import type { CliArguments, TemplateId, DatabaseProvider } from "./types.js";

const aliases: Readonly<Record<string, TemplateId>> = {
  "express-typescript": "express-typescript", express: "express-typescript", ts: "express-typescript",
  nestjs: "nestjs", nest: "nestjs", golang: "golang", go: "golang", dotnet: "dotnet", net: "dotnet", csharp: "dotnet",
  springboot: "springboot", spring: "springboot", java: "springboot", laravel: "laravel", php: "laravel", fastapi: "fastapi", python: "fastapi", py: "fastapi",
};
export function parsePort(value: string, name: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${name} must be an integer from 1 to 65535`);
  return Number(value);
}
export function parseCliArgs(args: readonly string[]): CliArguments {
  const { values, positionals } = parseArgs({ args: [...args], strict: true, allowPositionals: true, options: {
    template: { type: "string", short: "t" }, database: { type: "string" }, yes: { type: "boolean", short: "y" },
    "no-install": { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
    port: { type: "string" }, mode: { type: "string" }, "db-host": { type: "string" }, "db-port": { type: "string" },
    "db-name": { type: "string" }, "db-user": { type: "string" }, redis: { type: "boolean" }, "no-redis": { type: "boolean" },
    storage: { type: "string" }, "go-module": { type: "string" }, "java-package": { type: "string" }, "s3-endpoint": { type: "string" },
    "s3-docker-endpoint": { type: "string" }, "s3-region": { type: "string" }, "s3-bucket": { type: "string" }, "s3-access-key": { type: "string" },
  } });
  if (positionals.length > 1) throw new Error("Provide exactly one project folder name");
  const template = values.template === undefined ? undefined : aliases[values.template];
  if (values.template !== undefined && template === undefined) throw new Error("Unknown template; choose express-typescript, nestjs, golang, dotnet, fastapi, springboot, or laravel");
  const databases: Readonly<Record<string, DatabaseProvider>> = { postgresql: "postgresql", postgres: "postgresql", pg: "postgresql", mysql: "mysql" };
  const database = values.database === undefined ? undefined : databases[values.database];
  if (values.database !== undefined && database === undefined) throw new Error("Database must be postgresql or mysql");
  const mode = values.mode;
  const storage = values.storage;
  if (mode !== undefined && mode !== "manual" && mode !== "docker") throw new Error("Mode must be manual or docker");
  if (storage !== undefined && storage !== "local" && storage !== "s3") throw new Error("Storage must be local or s3");
  if (values.redis && values["no-redis"]) throw new Error("Use either --redis or --no-redis");
  return {
    ...(database === undefined ? {} : { database }),
    ...(positionals[0] === undefined ? {} : { projectName: positionals[0] }),
    ...(template === undefined ? {} : { template }), ...(mode === undefined ? {} : { mode }),
    ...(storage === undefined ? {} : { storage }),
    ...(values.port === undefined ? {} : { port: parsePort(values.port, "HTTP port") }),
    ...(values["db-port"] === undefined ? {} : { dbPort: parsePort(values["db-port"], "Database port") }),
    ...(values["db-host"] === undefined ? {} : { dbHost: values["db-host"] }),
    ...(values["db-name"] === undefined ? {} : { dbName: values["db-name"] }),
    ...(values["db-user"] === undefined ? {} : { dbUser: values["db-user"] }),
    ...(values["java-package"] === undefined ? {} : { javaPackage: values["java-package"] }),
    ...(values["go-module"] === undefined ? {} : { goModule: values["go-module"] }),
    ...(values["s3-endpoint"] === undefined ? {} : { s3Endpoint: values["s3-endpoint"] }),
    ...(values["s3-docker-endpoint"] === undefined ? {} : { s3DockerEndpoint: values["s3-docker-endpoint"] }),
    ...(values["s3-region"] === undefined ? {} : { s3Region: values["s3-region"] }),
    ...(values["s3-bucket"] === undefined ? {} : { s3Bucket: values["s3-bucket"] }),
    ...(values["s3-access-key"] === undefined ? {} : { s3AccessKey: values["s3-access-key"] }),
    ...(values.redis ? { redis: true } : values["no-redis"] ? { redis: false } : {}),
    yes: values.yes ?? false, noInstall: values["no-install"] ?? false, help: values.help ?? false, version: values.version ?? false,
  };
}
export function validateProjectName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name) || name.endsWith(".") ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error("Use a project folder name with letters, numbers, dots, underscores or hyphens (maximum 63 characters)");
}
export function validateGoModule(module: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._~-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._~-]*)+$/.test(module) || module.includes("..")) throw new Error("Invalid Go module path");
}
export const helpText = `Usage: create-ridhuan-backend [project-name] [options]
  --template, -t <express-typescript|nestjs|golang|dotnet|fastapi|springboot|laravel>
  --java-package <package>  Java namespace (Spring Boot only)
  --database <postgresql|mysql>  Default: postgresql
  --yes, -y                 Use defaults without prompting
  --no-install              Generate files and defer tool/dependency checks
  --mode <manual|docker>    Default: manual; Docker skips host dependency install
  --port <1..65535>         Manual HTTP and Compose host port
  --db-host <host> --db-port <port> --db-name <name> --db-user <user>
  --redis | --no-redis      Distributed rate limiter and cache
  --storage <local|s3>      Default: local
  --go-module <module>     Go only
  --s3-endpoint <url> --s3-docker-endpoint <url> --s3-region <region>
  --s3-bucket <bucket> --s3-access-key <key>
  --help, -h --version, -v
Passwords: masked interactive prompts, or RIDHUAN_DB_PASSWORD / RIDHUAN_S3_SECRET_KEY.
Default passwords are generated and saved only in the ignored .env.
npm create ridhuan-backend@latest my-api -- --template nestjs --yes
`;
