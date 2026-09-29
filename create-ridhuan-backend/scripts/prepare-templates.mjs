import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, join, sep, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatesDir = join(root, "templates");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
if (only && !["express-typescript", "golang", "dotnet", "nestjs"].includes(only)) throw new Error(`Unknown template: ${only}`);
// Ship only files the source repository does not ignore: local notes, build output and
// secrets are git-ignored there and must never reach a published template.
function notIgnored(source) {
  const files = execFileSync("git", ["-C", source, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const keep = new Set([""]);
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join("/"));
  }
  return (src) => keep.has(relative(source, src).split(sep).join("/"));
}

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
  "eslint.config.js",
  "README.md",
  "DEVELOPER-GUIDE.md",
  "src",
  "prisma",
  "tests",
];

await recreateTarget(expressTarget);
const expressFilter = notIgnored(expressSource);
for (const file of expressFiles) {
  await cp(join(expressSource, file), join(expressTarget, file), { recursive: true, filter: expressFilter });
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
const goFilter = notIgnored(goSource);
for (const file of goFiles) {
  await cp(join(goSource, file), join(goTarget, file), { recursive: true, filter: goFilter });
}
// Ship runtime commands and the documented Go initializer.
for (const command of ["api", "migrate", "seed", "cleanup-uploads", "initproject"]) {
  await cp(join(goSource, "cmd", command), join(goTarget, "cmd", command), { recursive: true, filter: goFilter });
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

const dotnetFilter = notIgnored(dotnetSource);

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
  "compose.override.yaml.example", "compose.yaml", "contracts", "docs", "scripts", "nest-cli.json", "package.json", "package-lock.json",
  "prisma.config.ts", "prisma", "src", "tsconfig.build.json", "tsconfig.json", "tsconfig.test.json",
];
await recreateTarget(nestTarget);
const nestFilter = notIgnored(nestSource);
for (const file of nestFiles) {
  await cp(join(nestSource, file), join(nestTarget, file), { recursive: true, filter: nestFilter });
}
console.log("Copied NestJS template files.");
}
console.log("All templates prepared successfully!");
