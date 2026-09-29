import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "dist/bin/index.js");

console.log("Running CLI verification tests...");

const scratch = await mkdtemp(join(tmpdir(), "ridhuan-backend-test-"));

try {
  // Test 1: Express TypeScript
  const tsProject = join(scratch, "test-ts-api");
  const tsResult = spawnSync(process.execPath, [cli, "test-ts-api", "--template", "express-typescript", "--yes", "--no-install"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (tsResult.status !== 0) {
    throw new Error(`Express TS scaffold failed: ${tsResult.stderr || tsResult.stdout}`);
  }
  const tsPkg = JSON.parse(await readFile(join(tsProject, "package.json"), "utf8"));
  const tsEnv = await readFile(join(tsProject, ".env"), "utf8");
  if (tsPkg.name !== "test-ts-api" || tsPkg.private !== true || !tsEnv.includes("APP_PORT=3000")) {
    throw new Error("Express TS scaffold validation failed");
  }
  console.log("✔ Express TypeScript scaffold verified");

  // Test 2: Golang
  const goProject = join(scratch, "test-go-api");
  const goResult = spawnSync(process.execPath, [cli, "test-go-api", "--template", "golang", "--yes", "--no-install"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (goResult.status !== 0) {
    throw new Error(`Golang scaffold failed: ${goResult.stderr || goResult.stdout}`);
  }
  const goMod = await readFile(join(goProject, "go.mod"), "utf8");
  const goEnv = await readFile(join(goProject, ".env"), "utf8");
  const goSeed = await readFile(join(goProject, "cmd", "seed", "main.go"), "utf8");
  const goMigrate = await readFile(join(goProject, "cmd", "migrate", "main.go"), "utf8");
  const goApi = await readFile(join(goProject, "cmd", "api", "main.go"), "utf8");
  const goCleanup = await readFile(join(goProject, "cmd", "cleanup-uploads", "main.go"), "utf8");
  const goInitializer = await readFile(join(goProject, "cmd", "initproject", "main.go"), "utf8");
  if (!goMod.includes("module example.com/test-go-api") || !goEnv.includes("PORT=3000") ||
      !goSeed.includes("manage_notifications") || !goMigrate.includes("package main") ||
      !goApi.includes("package main") || !goCleanup.includes("package main") ||
      !goInitializer.includes("package main")) {
    throw new Error("Golang scaffold validation failed");
  }
  console.log("✔ Golang scaffold verified");

  // Test 3: .NET
  const netProject = join(scratch, "TestNetApi");
  const netResult = spawnSync(process.execPath, [cli, "TestNetApi", "--template", "dotnet", "--yes", "--no-install"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (netResult.status !== 0) {
    throw new Error(`.NET scaffold failed: ${netResult.stderr || netResult.stdout}`);
  }
  const netSln = await readFile(join(netProject, "TestNetApi.slnx"), "utf8");
  const netEnv = await readFile(join(netProject, ".env"), "utf8");
  if (!netSln.includes("TestNetApi") || !netEnv.includes("Database=testnetapi;")) {
    throw new Error(".NET scaffold validation failed");
  }
  console.log("✔ .NET scaffold verified");

  // Test 4: NestJS
  const nestProject = join(scratch, "test-nest-api");
  const nestResult = spawnSync(process.execPath, [cli, "test-nest-api", "--template", "nestjs", "--yes", "--no-install"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (nestResult.status !== 0) throw new Error(`NestJS scaffold failed: ${nestResult.stderr || nestResult.stdout}`);
  const nestPkg = JSON.parse(await readFile(join(nestProject, "package.json"), "utf8"));
  const nestLock = JSON.parse(await readFile(join(nestProject, "package-lock.json"), "utf8"));
  const nestEnv = await readFile(join(nestProject, ".env"), "utf8");
  const nestUploads = await readFile(join(nestProject, "src", "modules", "uploads", "uploads.module.ts"), "utf8");
  const nestContract = JSON.parse(await readFile(join(nestProject, "contracts", "express-endpoints.json"), "utf8"));
  if (nestPkg.name !== "test-nest-api" || nestLock.name !== "test-nest-api" || nestLock.packages[""].name !== "test-nest-api" ||
      !nestEnv.includes("PORT=3000") || !nestEnv.includes("POSTGRES_DB=test_nest_api") ||
      nestEnv.includes("JWT_SECRET=replace_") || !nestEnv.includes("DATABASE_URL_DOCKER=postgresql://") ||
      !nestEnv.includes("REDIS_URL_DOCKER=redis://redis:6379") || !nestUploads.includes("MulterModule") ||
      nestContract.endpoints.length !== 29) {
    throw new Error("NestJS scaffold validation failed");
  }
  if ((await readdir(nestProject)).includes("node_modules") || (await readdir(join(nestProject, "src"))).includes("generated")) {
    throw new Error("NestJS scaffold includes generated dependencies or Prisma client");
  }
  console.log("✔ NestJS scaffold verified");

  // Test 5: Overwrite protection
  await writeFile(join(tsProject, "sample.txt"), "sample");
  const rejectResult = spawnSync(process.execPath, [cli, "test-ts-api", "--template", "express-typescript", "--yes"], {
    cwd: scratch,
    encoding: "utf8",
  });
  if (rejectResult.status === 0) {
    throw new Error("CLI should refuse to overwrite an existing non-empty directory");
  }
  console.log("✔ Directory overwrite protection verified");

  console.log("\nAll CLI verification tests passed successfully!");
} finally {
  if (!resolve(scratch).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Unsafe CLI test cleanup path");
  await rm(scratch, { recursive: true, force: true });
}
