import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { command } from "../dist/process.js";

const root = resolve(import.meta.dirname, "../..");
const repositories = {
  "express-typescript": "modular-express-typescript-starter-postgre",
  nestjs: "nestjs",
  golang: "modular-golang",
  dotnet: "modular-NET",
  fastapi: "modular-fastapi",
};
const counts = {};
for (const [id, directory] of Object.entries(repositories)) {
  const repo = join(root, directory);
  const tracked = command("git", ["ls-files", "-z"], repo);
  assert.equal(tracked.status, 0, "Cannot inspect tracked migrations");
  let count = 0;
  for (const name of tracked.stdout.split("\0").filter(Boolean)) {
    const migration =
      /migrations\//i.test(name) &&
      (name.endsWith(".sql") ||
        (name.endsWith(".cs") && !name.includes("ModelSnapshot")) ||
        (name.endsWith(".py") && name.includes("/versions/")));
    if (!migration) continue;
    const historical = command("git", ["show", `HEAD:${name}`], repo);
    assert.equal(historical.status, 0, "Cannot read historical migration");
    assert.equal(
      (await readFile(join(repo, name), "utf8")).replaceAll("\r\n", "\n"),
      historical.stdout.replaceAll("\r\n", "\n"),
      `Historical migration changed: ${directory}/${name}`,
    );
    count++;
  }
  counts[id] = count;
}
const tarball = process.env.CLI_TARBALL;
const archiveSha256 = tarball
  ? createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex")
  : null;
const result = {
  schemaVersion: 1,
  historicalMigrationsUnchanged: counts,
  archiveSha256,
  checkedAt: new Date().toISOString(),
};
await writeFile(
  join(tmpdir(), "hardening-source-audit.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
