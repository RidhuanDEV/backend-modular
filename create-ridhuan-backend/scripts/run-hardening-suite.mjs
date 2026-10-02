import { mkdir, writeFile, readFile, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { command } from "../dist/process.js";
import { collectProcessCase } from "./hardening-process.mjs";
import { cleanupHardeningFixtures } from "./hardening-fixture-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const argument = (flag) =>
  process.argv.includes(flag)
    ? process.argv[process.argv.indexOf(flag) + 1]
    : undefined;
const stage = argument("--stage") ?? "all";
const only = argument("--only")?.split(",");
const frameworks = [
  "express-typescript",
  "nestjs",
  "golang",
  "dotnet",
  "fastapi",
];
const providers = ["postgresql", "mysql"];
if (
  !["all", "native", "distribution", "compose", "remaining", "audit"].includes(
    stage,
  )
)
  throw new Error("Invalid test stage");
const tarball = resolve(
  process.env.CLI_TARBALL ?? join(tmpdir(), "create-ridhuan-backend-1.4.0.tgz"),
);
const directory = resolve(
  argument("--output") ??
    join(tmpdir(), `ridhuan-hardening-suite-${Date.now()}`),
);
await mkdir(directory, { recursive: true });
const cases = [];
const add = (id, group, args, options = {}) =>
  cases.push({
    id,
    group,
    executable: process.execPath,
    args,
    cwd: root,
    ...options,
  });
add("historical-migrations-and-archive-identity", "distribution", [
  "scripts/verify-hardening-source.mjs",
]);
add("cli-package-contracts", "distribution", ["scripts/verify-cli.mjs"]);
add("runner-unit-contracts", "distribution", [
  "--test",
  "scripts/test-hardening-runner.mjs",
]);
add("dependency-and-lock-audits", "audit", [
  "scripts/verify-hardening-dependencies.mjs",
]);
for (const framework of frameworks)
  for (const provider of providers) {
    const suffix = `${framework}-${provider}`;
    add(`host-consumer-${suffix}`, "distribution", [
      "scripts/verify-consumer.mjs",
      framework,
      provider,
    ]);
    add(
      `database-${suffix}`,
      "native",
      [
        "scripts/verify-native-databases.mjs",
        "--framework",
        framework === "express-typescript" ? "express" : framework,
        "--provider",
        provider,
      ],
      { docker: true },
    );
    add(
      `compose-${suffix}`,
      "compose",
      ["scripts/verify-compose.mjs", framework, provider],
      { docker: true },
    );
  }
// Native consumers include native build/lint/unit/contracts and module generators.
// The Linux image has a small .NET-only target for the final remaining cases.
const image =
  stage === "remaining"
    ? "ridhuan-hardening-dotnet-consumer:local"
    : "ridhuan-hardening-linux-consumer:local";
add(
  "linux-consumer-image",
  "distribution",
  [
    "build",
    "-f",
    "scripts/fixtures/linux-consumer.Dockerfile",
    ...(stage === "remaining" ? ["--target", "dotnet-consumer"] : []),
    "-t",
    image,
    ".",
  ],
  { executable: "docker", docker: true },
);
for (const framework of frameworks)
  for (const provider of providers)
    add(
      `linux-consumer-${framework}-${provider}`,
      "distribution",
      [
        "run",
        "--rm",
        "--name",
        `hardening-linux-${framework}-${provider}`,
        "-e",
        "CLI_TARBALL=/artifact.tgz",
        "-v",
        `${tarball}:/artifact.tgz:ro`,
        image,
        framework,
        provider,
      ],
      { executable: "docker", docker: true },
    );
const remaining = new Set([
  "historical-migrations-and-archive-identity",
  "cli-package-contracts",
  ...["golang", "nestjs", "dotnet"].flatMap((framework) =>
    providers.map((provider) => `compose-${framework}-${provider}`),
  ),
  "linux-consumer-image",
  ...providers.map((provider) => `linux-consumer-dotnet-${provider}`),
]);
let selected = cases.filter(
  (item) =>
    stage === "all" ||
    (stage === "remaining" ? remaining.has(item.id) : item.group === stage),
);
if (only) {
  if (only.some((id) => !selected.some((item) => item.id === id)))
    throw new Error("Unknown case ID for this stage");
  selected = selected.filter((item) => only.includes(item.id));
}
const plan = {
  schemaVersion: 1,
  hostPlatform: process.platform,
  stage,
  tarball,
  authoredAt: new Date().toISOString(),
  inventory: cases,
  selected: selected.map((item) => item.id),
  policy:
    "Collect every independent case; do not hide failures or automatically retry. API scenarios fail at the assertion and cleanup runs in finally.",
};
await writeFile(join(directory, "plan.json"), JSON.stringify(plan, null, 2));
console.log(
  `Full test plan saved before execution: ${join(directory, "plan.json")}`,
);
if (!process.argv.includes("--run")) {
  console.log("Review the plan; pass --run to execute it.");
  process.exit(0);
}
await readFile(tarball); // Missing artifacts fail before touching runtime resources.
const results = [];
const cleanupResults = [];
async function cleanup() {
  if (!selected.some((item) => item.docker)) return;
  // This runner owns only cases recorded in its own log directory. Other
  // collecting stages can run audits without touching an active API fixture.
  for (const location of [directory]) {
    try {
      cleanupResults.push(await cleanupHardeningFixtures(location));
    } catch (error) {
      cleanupResults.push({
        error: error instanceof Error ? error.message : "Cleanup failed",
      });
    }
  }
}
await cleanup();
try {
  for (const item of selected) {
    const started = Date.now();
    const log = join(directory, `hardening-${item.id}.log`);
    console.log(`START ${item.id}`);
    if (item.docker) {
      const space = await statfs(root, { bigint: true });
      if (space.bavail * space.bsize < 1024n * 1024n * 1024n) {
        results.push({
          id: item.id,
          status: "BLOCKED",
          reason: "Less than 1 GiB free on the workspace/Docker host drive",
          log,
        });
        console.log(`BLOCKED ${item.id}: disk space`);
        continue;
      }
    }
    const result = await collectProcessCase(item, log, {
      ...process.env,
      CLI_TARBALL: tarball,
    });
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    results.push({
      id: item.id,
      status,
      ...result,
      durationMs: Date.now() - started,
      log,
    });
    console.log(`${status} ${item.id}; log: ${log}`);
    await cleanup();
    await writeFile(
      join(directory, "results.json"),
      JSON.stringify({ schemaVersion: 1, results, cleanupResults }, null, 2),
    );
  }
} finally {
  await cleanup();
  // Delete only this suite's disposable Linux consumer image tag.
  if (selected.some((item) => item.id === "linux-consumer-image")) {
    const result = command("docker", ["image", "rm", image], root);
    cleanupResults.push({ consumerImage: image, exitCode: result.status });
  }
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        completedAt: new Date().toISOString(),
        results,
        cleanupResults,
      },
      null,
      2,
    ),
  );
}
const failures = results.filter((result) => result.status !== "PASS");
const cleanupFailed = cleanupResults.some(
  (result) =>
    result.error ||
    result.failures?.length ||
    (result.exitCode !== undefined && result.exitCode !== 0),
);
console.log(
  `Results: ${results.length - failures.length}/${results.length} passed; ${failures.length} failed/blocked. Report: ${join(directory, "results.json")}`,
);
if (failures.length || cleanupFailed) process.exitCode = 1;
