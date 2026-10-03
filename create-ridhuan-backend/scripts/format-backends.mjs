import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { command } from "../dist/process.js";

const root = resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");
const logs = mkdtempSync(join(tmpdir(), "ridhuan-format-"));
const excluded = [
  "src/ModularBackend.Infrastructure/Persistence/Migrations",
  "src/ModularBackend.Infrastructure/Persistence/MySqlMigrations",
];
const tasks = [
  [
    "express",
    "modular-express-typescript-starter-postgre",
    "npm",
    ["run", check ? "format:check" : "format"],
  ],
  ["nestjs", "nestjs", "npm", ["run", check ? "format:check" : "format"]],
  [
    "laravel",
    "modular-laravel",
    "composer",
    [check ? "format:check" : "format"],
  ],
  [
    "springboot",
    "modular-springboot",
    "mvnw",
    ["-DskipTests", check ? "spotless:check" : "spotless:apply"],
  ],
  [
    "fastapi",
    "modular-fastapi",
    "uv",
    [
      "run",
      "--locked",
      "ruff",
      "format",
      ...(check ? ["--check"] : []),
      "src",
      "tests",
      "scripts",
    ],
  ],
  [
    "dotnet",
    "modular-NET",
    "dotnet",
    [
      "format",
      "whitespace",
      "ModularBackend.slnx",
      ...(check ? ["--verify-no-changes"] : []),
      "--exclude",
      ...excluded,
    ],
  ],
  [
    "golang",
    "modular-golang",
    "gofmt",
    [check ? "-l" : "-w", "cmd", "internal"],
  ],
];
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex < 0 ? undefined : process.argv[onlyIndex + 1];
if (onlyIndex >= 0 && !tasks.some(([id]) => id === only))
  throw new Error("Unknown --only backend");
const results = [];
for (const [id, directory, executable, args] of tasks) {
  if (only && only !== id) continue;
  try {
    const cwd = join(root, directory);
    let native = executable;
    if (id === "golang") {
      const runtime = command("go", ["env", "GOROOT"], cwd);
      if (runtime.status !== 0 || runtime.error)
        throw new Error(runtime.stderr || String(runtime.error));
      native = join(
        runtime.stdout.trim(),
        "bin",
        process.platform === "win32" ? "gofmt.exe" : "gofmt",
      );
    }
    const result = command(native, args, cwd);
    const passed =
      result.status === 0 &&
      !result.error &&
      !(id === "golang" && check && result.stdout.trim());
    writeFileSync(
      join(logs, `${id}.log`),
      `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error ?? ""}`,
    );
    results.push({
      id,
      passed,
      exitCode: result.status,
      signal: result.signal,
    });
    console.log(`${id}: ${passed ? "PASSED" : "FAILED"}`);
  } catch (error) {
    writeFileSync(join(logs, `${id}.log`), String(error));
    results.push({ id, passed: false, error: String(error) });
    console.log(`${id}: FAILED`);
  }
}
writeFileSync(join(logs, "report.json"), JSON.stringify(results, null, 2));
console.log(`Logs: ${logs}`);
process.exitCode = results.every(({ passed }) => passed) ? 0 : 1;
