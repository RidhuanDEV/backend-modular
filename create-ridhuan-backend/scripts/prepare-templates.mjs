import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatesDir = join(root, "templates");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
if (only && !["express-typescript", "golang", "dotnet", "nestjs"].includes(only)) throw new Error(`Unknown template: ${only}`);
async function recreateTarget(target) {
  const absolute = resolve(target);
  if (!absolute.startsWith(`${resolve(templatesDir)}${sep}`)) throw new Error(`Template target outside package: ${absolute}`);
  await rm(absolute, { recursive: true, force: true });
  await mkdir(absolute, { recursive: true });
}

// 1. Prepare express-typescript
if (!only || only === "express-typescript") {
const expressSource = resolve(root, "../modular-express-typescript-starter-postgre");
const expressTarget = join(templatesDir, "express-typescript");
const expressFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.override.yml",
  "package.json",
  "package-lock.json",
  "prisma.config.ts",
  "tsconfig.json",
  "README.md",
  "DEVELOPER-GUIDE.md",
  "src",
  "prisma",
  "tests",
];

await recreateTarget(expressTarget);
for (const file of expressFiles) {
  await cp(join(expressSource, file), join(expressTarget, file), { recursive: true });
}
console.log("Copied express-typescript template files.");
}

// 2. Prepare golang
if (!only || only === "golang") {
const goSource = resolve(root, "../modular-golang");
const goTarget = join(templatesDir, "golang");
const goFiles = [
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "compose.override.yaml.example",
  "compose.yaml",
  "CONTRIBUTING.md",
  "Dockerfile",
  "go.mod",
  "go.sum",
  "Makefile",
  "README.md",
  "SECURITY.md",
  "sqlc.yaml",
  "CHANGELOG.md",
  "contracts",
  "docs",
  "internal",
  "scripts",
];

await recreateTarget(goTarget);
for (const file of goFiles) {
  await cp(join(goSource, file), join(goTarget, file), { recursive: true });
}
// Ship runtime commands and the documented Go initializer.
for (const command of ["api", "migrate", "seed", "cleanup-uploads", "initproject"]) {
  await cp(join(goSource, "cmd", command), join(goTarget, "cmd", command), { recursive: true });
}
console.log("Copied golang template files.");
}

// 3. Prepare dotnet
if (!only || only === "dotnet") {
const dotnetSource = resolve(root, "../modular-NET");
const dotnetTarget = join(templatesDir, "dotnet");
const dotnetFiles = [
  ".template.config",
  "contracts",
  "docs",
  "scripts",
  "src",
  "tests",
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "CHANGELOG.md",
  "compose.override.yaml.example",
  "compose.yaml",
  "CONTRIBUTING.md",
  "Directory.Build.props",
  "Directory.Packages.props",
  "Dockerfile",
  "dotnet-tools.json",
  "global.json",
  "LICENSE",
  "ModularBackend.slnx",
  "NuGet.Config",
  "README.id.md",
  "README.md",
  "SECURITY.md",
];

await recreateTarget(dotnetTarget);

function dotnetFilter(src) {
  const normalized = src.replace(/\\/g, "/");
  if (
    normalized.includes("/bin/") ||
    normalized.endsWith("/bin") ||
    normalized.includes("/obj/") ||
    normalized.endsWith("/obj") ||
    normalized.includes("/TestResults") ||
    normalized.includes("/uploads")
  ) {
    return false;
  }
  return true;
}

for (const file of dotnetFiles) {
  await cp(join(dotnetSource, file), join(dotnetTarget, file), {
    recursive: true,
    filter: dotnetFilter,
  });
}
console.log("Copied dotnet template files.");
}

// 4. Prepare NestJS from its separate source repository.
if (!only || only === "nestjs") {
const nestSource = resolve(root, "../nestjs");
const nestTarget = join(templatesDir, "nestjs");
const nestFiles = [
  ".dockerignore", ".env.example", ".gitignore", ".github", "AGENTS.md", "Dockerfile", "LICENSE", "README.md",
  "compose.override.yaml.example", "compose.yaml", "contracts", "docs", "nest-cli.json", "package.json", "package-lock.json",
  "prisma.config.ts", "prisma", "src", "tsconfig.build.json", "tsconfig.json", "tsconfig.test.json",
];
await recreateTarget(nestTarget);
function nestFilter(src) {
  const normalized = src.replace(/\\/g, "/");
  const relative = normalized.slice(nestSource.replace(/\\/g, "/").length).replace(/^\/+/, "");
  const topLevel = relative.split("/")[0];
  return topLevel !== "node_modules" && topLevel !== ".legacy" && topLevel !== "dist" &&
    topLevel !== "uploads" && !relative.startsWith("src/generated/") &&
    relative !== "src/generated" && relative !== ".env" &&
    relative !== "openapi.json" && !relative.endsWith(".tsbuildinfo");
}
for (const file of nestFiles) {
  await cp(join(nestSource, file), join(nestTarget, file), { recursive: true, filter: nestFilter });
}
console.log("Copied NestJS template files.");
}
console.log("All templates prepared successfully!");
