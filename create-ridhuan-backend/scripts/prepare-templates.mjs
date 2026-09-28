import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatesDir = join(root, "templates");

// 1. Prepare express-typescript
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

await rm(expressTarget, { recursive: true, force: true });
await mkdir(expressTarget, { recursive: true });
for (const file of expressFiles) {
  await cp(join(expressSource, file), join(expressTarget, file), { recursive: true });
}
console.log("Copied express-typescript template files.");

// 2. Prepare golang
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

await rm(goTarget, { recursive: true, force: true });
await mkdir(goTarget, { recursive: true });
for (const file of goFiles) {
  await cp(join(goSource, file), join(goTarget, file), { recursive: true });
}
// Copy only cmd/api (not cmd/initproject)
await cp(join(goSource, "cmd", "api"), join(goTarget, "cmd", "api"), { recursive: true });
console.log("Copied golang template files.");

// 3. Prepare dotnet
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

await rm(dotnetTarget, { recursive: true, force: true });
await mkdir(dotnetTarget, { recursive: true });

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
console.log("All templates prepared successfully!");
