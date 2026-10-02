import { resolve, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { command } from "../dist/process.js";

const root = resolve(import.meta.dirname, "../..");
const checks = [
  ...[
    "create-ridhuan-backend",
    "modular-express-typescript-starter-postgre",
    "nestjs",
  ].map((directory) => ({
    id: directory,
    executable: "npm",
    args: ["audit", "--json"],
    cwd: join(root, directory),
    format: "npm",
  })),
  {
    id: "dotnet",
    executable: "dotnet",
    args: [
      "list",
      "package",
      "--vulnerable",
      "--include-transitive",
      "--format",
      "json",
      "--no-restore",
    ],
    cwd: join(root, "modular-NET"),
    format: "nuget",
  },
  {
    id: "golang-vulnerabilities",
    executable: "go",
    args: ["run", "golang.org/x/vuln/cmd/govulncheck@v1.8.0", "./..."],
    cwd: join(root, "modular-golang"),
    format: "text",
  },
  {
    id: "golang-module-integrity",
    executable: "go",
    args: ["mod", "verify"],
    cwd: join(root, "modular-golang"),
    format: "text",
  },
  {
    id: "fastapi-vulnerabilities",
    executable: "uv",
    args: ["run", "--locked", "pip-audit", "--format", "json"],
    cwd: join(root, "modular-fastapi"),
    format: "pip",
  },
  {
    id: "fastapi-lock",
    executable: "uv",
    args: ["lock", "--check"],
    cwd: join(root, "modular-fastapi"),
    format: "text",
  },
];
const results = [];
for (const check of checks) {
  const result = command(check.executable, check.args, check.cwd, false, {
    GOMAXPROCS: "2",
    GOMEMLIMIT: "512MiB",
  });
  let passed = result.status === 0 && !result.error;
  let findings = 0;
  try {
    if (check.format === "npm")
      findings = JSON.parse(result.stdout).metadata.vulnerabilities.total;
    if (check.format === "nuget") {
      const report = JSON.parse(result.stdout);
      if (!Array.isArray(report.projects))
        throw new Error("Invalid NuGet audit contract");
      for (const project of report.projects)
        for (const framework of project.frameworks ?? [])
          for (const pkg of [
            ...(framework.topLevelPackages ?? []),
            ...(framework.transitivePackages ?? []),
          ])
            findings += pkg.vulnerabilities?.length ?? 0;
    }
    if (check.format === "pip") {
      const report = JSON.parse(result.stdout);
      if (!Array.isArray(report.dependencies))
        throw new Error("Invalid pip-audit contract");
      for (const dependency of report.dependencies)
        findings += dependency.vulns?.length ?? 0;
    }
    if (!Number.isInteger(findings) || findings < 0)
      throw new Error("Invalid vulnerability count");
    passed = passed && findings === 0;
  } catch (error) {
    passed = false;
    console.error(
      `${check.id}: ${error instanceof Error ? error.message : "Invalid audit output"}`,
    );
  }
  // Audit payloads contain package/advisory metadata, never local env values.
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  results.push({ id: check.id, passed, findings, exitCode: result.status });
  console.log(`${passed ? "PASS" : "FAIL"} ${check.id}`);
}
await writeFile(
  join(tmpdir(), "hardening-dependency-results.json"),
  JSON.stringify(
    { schemaVersion: 1, checkedAt: new Date().toISOString(), results },
    null,
    2,
  ),
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
