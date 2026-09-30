import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = join(root, "templates");
const allowedDirty = process.argv.includes("--allow-dirty");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
const descriptors = {
  "express-typescript": { source: "modular-express-typescript-starter-postgre", identity: "backend", paths: [".gitattributes", ".dockerignore", ".env.example", ".gitignore", "LICENSE", "Dockerfile", "docker-compose.yml", "docker-compose.override.yml", "package.json", "package-lock.json", "prisma.config.ts", "tsconfig.json", "eslint.config.js", "README.md", "DEVELOPER-GUIDE.md", "src", "prisma", "tests", "scripts/minio.Dockerfile", "scripts/init-bucket.sh"] },
  nestjs: { source: "nestjs", identity: "modular-nestjs", paths: [".gitattributes", ".dockerignore", ".env.example", ".gitignore", "Dockerfile", "LICENSE", "README.md", "compose.override.yaml.example", "compose.yaml", "contracts", "docs", "scripts", "nest-cli.json", "package.json", "package-lock.json", "prisma.config.ts", "prisma", "src", "tsconfig.build.json", "tsconfig.json", "tsconfig.test.json"] },
  golang: { source: "modular-golang", paths: [".gitattributes", ".dockerignore", ".env.example", ".gitignore", "LICENSE", "compose.override.yaml.example", "compose.yaml", "CONTRIBUTING.md", "Dockerfile", "go.mod", "go.sum", "Makefile", "README.md", "SECURITY.md", "sqlc.yaml", "CHANGELOG.md", "contracts", "docs", "internal", "scripts", "cmd/api", "cmd/migrate", "cmd/seed", "cmd/cleanup-uploads", "cmd/initproject"] },
  dotnet: { source: "modular-NET", identity: "ModularBackend", paths: [".template.config", "contracts", "docs", "scripts", "src", "tests", "tools", "templates", ".dockerignore", ".editorconfig", ".env.example", ".gitattributes", ".gitignore", "CHANGELOG.md", "compose.override.yaml.example", "compose.yaml", "CONTRIBUTING.md", "Directory.Build.props", "Directory.Packages.props", "Dockerfile", "dotnet-tools.json", "global.json", "LICENSE", "ModularBackend.slnx", "NuGet.Config", "README.id.md", "README.md", "SECURITY.md"] },
};
if (only && !Object.hasOwn(descriptors, only)) throw new Error("Unknown template selection");
const git = (source, ...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
const unsafe = /(^|\/)(?:node_modules|\.git|bin|obj|dist|coverage|\.legacy)(\/|$)|(?:^|\/)\.env(?:\.|$)(?!example$)|^uploads(\/|$)|\.tgz$|\.log$|(?:^|\/)\.tmp-/;

for (const [id, descriptor] of Object.entries(descriptors)) {
  if (only && only !== id) continue;
  const source = resolve(root, "..", descriptor.source);
  const dirty = git(source, "status", "--porcelain").length > 0;
  if (dirty && !allowedDirty) throw new Error(`${id}: source has uncommitted changes. Commit tested source before release; --allow-dirty is for local verification only.`);
  const tracked = new Set(git(source, "ls-files", "-z", "--cached", ...(allowedDirty ? ["--others", "--exclude-standard"] : [])).split("\0").filter(Boolean));
  const target = join(destination, id);
  if (!resolve(target).startsWith(resolve(destination) + sep)) throw new Error("Invalid snapshot path");
  await rm(target, { recursive: true, force: true });
  const selected = new Set();
  for (const path of descriptor.paths) {
    const matching = [...tracked].filter((file) => file === path || file.startsWith(path + "/"));
    if (!matching.length) throw new Error(`${id}: required snapshot path absent: ${path}`);
    for (const file of matching) if (!unsafe.test(file)) selected.add(file);
  }
  for (const file of [...selected].sort()) {
    const output = file === ".gitignore" ? "gitignore.template" : file;
    await mkdir(join(target, output, ".."), { recursive: true });
    const bytes = await readFile(join(source, file));
    let normalized = bytes;
    if (!bytes.includes(0)) {
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        normalized = Buffer.from(decoded.replaceAll("\r\n", "\n"));
      } catch { /* Binary template assets keep their exact bytes. */ }
    }
    await writeFile(join(target, output), normalized);
  }
  let requirements;
  let identity = descriptor.identity;
  if (id === "golang") {
    const module = await readFile(join(target, "go.mod"), "utf8");
    identity = /^module (.+)$/m.exec(module)?.[1];
    requirements = { go: /^go (.+)$/m.exec(module)?.[1] };
  } else if (id === "dotnet") {
    requirements = { dotnet: JSON.parse(await readFile(join(target, "global.json"), "utf8")).sdk.version };
    const solution = await readFile(join(target, "ModularBackend.slnx"), "utf8");
    for (const [, project] of solution.matchAll(/<Project Path="([^"]+)"/g)) await readFile(join(target, project));
  } else {
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    requirements = { node: pkg.engines.node };
    for (const command of Object.values(pkg.scripts)) for (const [, script] of command.matchAll(/(?:node|tsx) (scripts\/[^\s]+|tests\/[^\s]+)/g)) await readFile(join(target, script));
  }
  const hashes = {};
  async function hashTree(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await hashTree(join(directory, entry.name), path + "/");
      else hashes[path] = createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex");
    }
  }
  await hashTree(target);
  await writeFile(join(target, "template-manifest.json"), JSON.stringify({ schemaVersion: 1, id, source: { repository: git(source, "remote", "get-url", "origin"), commit: git(source, "rev-parse", "HEAD"), dirty }, requirements, identity, files: hashes }, null, 2) + "\n");
  console.log(`${id}: ${Object.keys(hashes).length} verified source files${dirty ? " (development snapshot)" : ""}`);
}
