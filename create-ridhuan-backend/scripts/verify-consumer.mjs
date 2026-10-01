import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { verifyManual } from "./verify-manual.mjs";
import { command } from "../dist/process.js";

const id = process.argv[2];
if (!["express-typescript", "nestjs", "golang", "dotnet", "fastapi"].includes(id)) throw new Error("Supply a template ID");
const database = process.argv[3] ?? "postgresql";
if (!["postgresql", "mysql"].includes(database)) throw new Error("Supply postgresql or mysql");
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), `ridhuan ${id} consumer-`));
const name = id === "dotnet" ? "Verified.Api" : "verified-api";
const project = join(scratch, name);
function run(executable, args, cwd = project) {
  const result = command(executable, args, cwd, true);
  if (result.status !== 0 || result.error) throw new Error(`${executable} ${args.join(" ")} failed`);
}
try {
  let tarball = process.env.CLI_TARBALL;
  if (!tarball) {
    const packed = command("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch], root);
    if (packed.status !== 0) throw new Error("Pack failed");
    tarball = join(scratch, JSON.parse(packed.stdout)[0].filename);
  }
  await writeFile(join(scratch, "package.json"), '{"name":"isolated-consumer","private":true}\n');
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(tarball)], scratch);
  run(process.execPath, [join(scratch, "node_modules/create-ridhuan-backend/dist/bin/index.js"), name, "--template", id, "--database", database, "--yes"], scratch);
  if (id === "golang") {
    process.env.GOMAXPROCS = "2"; process.env.GOMEMLIMIT = "512MiB";
    run("go", ["build", "-p", "1", "./..."]);
    run("go", ["vet", "-p", "1", "./..."]);
    run("go", ["test", "-p", "1", "./..."]);
  } else if (id === "dotnet") {
    run("dotnet", ["build", "-c", "Release", "--no-restore", "-m:1"]);
    for (const suite of ["UnitTests", "ContractTests"]) run("dotnet", ["test", `tests/VerifiedApi.${suite}`, "-c", "Release", "--no-build", "--no-restore"]);
  } else if (id === "fastapi") {
    run("uv", ["run", "--locked", "python", "scripts/verify.py"]);
    run("uv", ["run", "--locked", "backend", "generate-module", "consumer_example"]);
    run("uv", ["run", "--locked", "backend", "generate-module", "settings"]);
    run("uv", ["run", "--locked", "ruff", "check", "."]);
    run("uv", ["run", "--locked", "ruff", "format", "--check", "."]);
    run("uv", ["run", "--locked", "pyright"]);
    run("uv", ["run", "--locked", "pytest", "tests/unit", "-q"]);
    const docs = command("uv", ["run", "--locked", "backend", "openapi"], project);
    if (docs.status !== 0 || !JSON.parse(docs.stdout).paths["/api/consumer_example"]) throw new Error("Generated module OpenAPI is missing");
  } else {
    run("npm", ["run", "verify:template"]);
    if (id === "nestjs") {
      run("npm", ["run", "generate:feature", "--", "consumer-example"]);
      run("npm", ["run", "build"]);
    } else {
      const schemaPath = join(project, database === "mysql" ? "prisma/mysql/schema.prisma" : "prisma/schema.prisma");
      await writeFile(schemaPath, `${await readFile(schemaPath, "utf8")}\nmodel ConsumerExample {\n  id String @id @default(uuid())\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n}\n`);
      run("npm", ["run", "make:crud", "--", "consumer-example"]);
      run("npm", ["run", "build"]);
    }
  }
  if (process.argv.includes("--runtime") || process.env.CLI_RUNTIME_TEST === "true") await verifyManual(project, id, database);
  console.log(`${id}/${database}: installed tarball consumer gates passed`);
} finally {
  if (process.argv.includes("--keep")) console.log(`Consumer fixture: ${project}`);
  else {
    if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid cleanup scope");
    await rm(scratch, { recursive: true, force: true });
  }
}
