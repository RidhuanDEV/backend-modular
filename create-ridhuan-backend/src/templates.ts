import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseProvider, TemplateDescriptor, TemplateId, TemplateManifest, ProjectAnswers } from "./types.js";

export const templateRegistry = {
  "express-typescript": { id: "express-typescript", label: "Express TypeScript", hint: "Prisma, Zod, JWT, RBAC",
    defaultPort: 3000, containerPort: 3000, dbPort: 5432, redisPort: 6379, storagePort: 9000,
    storageHost: "minio:9000", storageProfile: "minio", composeFile: "docker-compose.yml", install: { command: "npm", args: ["ci"] } },
  nestjs: { id: "nestjs", label: "NestJS", hint: "Prisma, class-validator, JWT, RBAC",
    defaultPort: 3000, containerPort: 3000, dbPort: 5432, redisPort: 6379, storagePort: 9000,
    storageHost: "minio:9000", storageProfile: "s3", composeFile: "compose.yaml", install: { command: "npm", args: ["ci"] } },
  golang: { id: "golang", label: "Golang", hint: "Chi, Huma, sqlc, Goose",
    defaultPort: 8080, containerPort: 8080, dbPort: 5432, redisPort: 6379, storagePort: 9000,
    storageHost: "minio:9000", storageProfile: "minio", composeFile: "compose.yaml", install: { command: "go", args: ["mod", "download"] } },
  dotnet: { id: "dotnet", label: "ASP.NET Core", hint: "EF Core, Npgsql, JWT, RBAC",
    defaultPort: 5080, containerPort: 8080, dbPort: 55432, redisPort: 56379, storagePort: 19000,
    storageHost: "s3mock:9090", storageProfile: "s3", composeFile: "compose.yaml", install: { command: "dotnet", args: ["restore", "--locked-mode"] } },
  fastapi: { id: "fastapi", label: "FastAPI", hint: "Pydantic, SQLAlchemy, Alembic, JWT, RBAC",
    defaultPort: 8000, containerPort: 8000, dbPort: 5432, redisPort: 6379, storagePort: 9000,
    storageHost: "minio:9000", storageProfile: "s3", composeFile: "compose.yaml", install: { command: "uv", args: ["sync", "--locked"] } },
} as const satisfies Record<TemplateId, TemplateDescriptor>;

export function usesLocalStorage(answers: Pick<ProjectAnswers, "templateId" | "uploadStorage" | "s3DockerEndpoint">): boolean {
  const endpoint = new URL(answers.s3DockerEndpoint);
  return answers.uploadStorage === "s3" && endpoint.origin === `http://${templateRegistry[answers.templateId].storageHost}` &&
    endpoint.pathname === "/" && !endpoint.search && !endpoint.hash;
}

export function objectRecord(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${description}`);
  return value as Record<string, unknown>;
}
export async function readManifest(source: string, id: TemplateId): Promise<TemplateManifest> {
  const value: unknown = JSON.parse(await readFile(join(source, "template-manifest.json"), "utf8"));
  const manifest = objectRecord(value, "template manifest");
  const provenance = objectRecord(manifest.source, "template source");
  const requirements = objectRecord(manifest.requirements, "runtime requirements");
  const files = objectRecord(manifest.files, "template file hashes");
  const providers: unknown = manifest.schemaVersion === 1 ? ["postgresql"] : manifest.databaseProviders;
  if (!Array.isArray(providers) || providers.length === 0 ||
      providers.some((provider: unknown) => provider !== "postgresql" && provider !== "mysql") ||
      new Set(providers).size !== providers.length) throw new Error("Invalid database capabilities");
  const databaseProviders: DatabaseProvider[] = providers.map((provider: unknown) => {
    if (provider === "postgresql" || provider === "mysql") return provider;
    throw new Error("Invalid database provider");
  });
  if (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2 || manifest.id !== id || typeof manifest.identity !== "string" ||
      typeof provenance.repository !== "string" || typeof provenance.dirty !== "boolean" ||
      !(typeof provenance.commit === "string" && /^[a-f0-9]{40}$/.test(provenance.commit) || manifest.schemaVersion === 2 && provenance.commit === null && provenance.dirty === true)) throw new Error("Invalid template provenance");
  for (const [key, requirement] of Object.entries(requirements)) {
    if (!["node", "go", "dotnet", "python", "uv"].includes(key) || typeof requirement !== "string") throw new Error("Invalid runtime requirement");
  }
  const hashes: Record<string, string> = {};
  for (const [path, hash] of Object.entries(files)) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid template file hash");
    hashes[path] = hash;
  }
  return { schemaVersion: manifest.schemaVersion, databaseProviders, id, identity: manifest.identity,
    source: { repository: provenance.repository, commit: typeof provenance.commit === "string" ? provenance.commit : null, dirty: provenance.dirty },
    requirements: {
      ...(typeof requirements.node === "string" ? { node: requirements.node } : {}),
      ...(typeof requirements.go === "string" ? { go: requirements.go } : {}),
      ...(typeof requirements.dotnet === "string" ? { dotnet: requirements.dotnet } : {}),
      ...(typeof requirements.python === "string" ? { python: requirements.python } : {}),
      ...(typeof requirements.uv === "string" ? { uv: requirements.uv } : {}),
    }, files: hashes };
}
