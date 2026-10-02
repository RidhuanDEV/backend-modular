import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { command } from "../dist/process.js";

// Ownership comes from this task's recorded logs, never from a global prune.
export async function cleanupHardeningFixtures(
  logDirectory = tmpdir(),
  { discoverTemporaryOwners = false } = {},
) {
  const projects = new Set();
  for (const entry of await readdir(logDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^hardening-.*\.log$/.test(entry.name)) continue;
    const log = await readFile(join(logDirectory, entry.name), "utf8");
    for (const match of log.matchAll(/\bacceptance-api-[a-f0-9]{8}\b/g))
      projects.add(match[0]);
  }
  const failures = [];
  const removed = { containers: 0, volumes: 0, networks: 0, imageTags: 0 };
  function docker(args) {
    const result = command("docker", args, resolve(import.meta.dirname, ".."));
    if (result.status !== 0 || result.error) {
      failures.push({
        operation: args.slice(0, 2).join(" "),
        status: result.status,
      });
      return undefined;
    }
    return result.stdout.trim();
  }
  const inventory = docker(["ps", "-a", "--format", "{{json .}}"]);
  if (inventory === undefined)
    return { removed, failures, projects: projects.size };
  for (const line of inventory.split("\n").filter(Boolean)) {
    const item = JSON.parse(line);
    if (typeof item.ID !== "string")
      throw new Error("Invalid Docker container inventory");
    const inspected = docker(["inspect", item.ID]);
    if (!inspected) continue;
    const container = JSON.parse(inspected)[0];
    const owner = container.Config?.Labels?.["com.docker.compose.project"];
    const workingDirectory =
      container.Config?.Labels?.["com.docker.compose.project.working_dir"];
    if (
      discoverTemporaryOwners &&
      typeof owner === "string" &&
      /^acceptance-api-[a-f0-9]{8}$/.test(owner) &&
      typeof workingDirectory === "string"
    ) {
      const parts = relative(
        resolve(tmpdir()),
        resolve(workingDirectory),
      ).split(sep);
      if (
        parts.length === 2 &&
        /^ridhuan (?:express-typescript|nestjs|golang|dotnet|fastapi) compose-[a-zA-Z0-9]+$/.test(
          parts[0],
        ) &&
        ["acceptance-api", "Acceptance.Api"].includes(parts[1])
      )
        projects.add(owner);
    }
    if (typeof owner !== "string" || !projects.has(owner)) continue;
    if (docker(["rm", "-f", "-v", item.ID]) !== undefined) removed.containers++;
  }
  for (const owner of projects) {
    for (const kind of ["volume", "network"]) {
      const names = docker([
        kind,
        "ls",
        "--filter",
        `label=com.docker.compose.project=${owner}`,
        "--format",
        "{{.Name}}",
      ]);
      if (names === undefined) continue;
      for (const name of names.split("\n").filter(Boolean)) {
        const inspected = docker([kind, "inspect", name]);
        if (!inspected) continue;
        const resource = JSON.parse(inspected)[0];
        if (resource.Labels?.["com.docker.compose.project"] !== owner)
          throw new Error("Docker resource ownership changed during cleanup");
        if (kind === "network" && Object.keys(resource.Containers ?? {}).length)
          continue;
        if (docker([kind, "rm", name]) !== undefined)
          removed[kind === "volume" ? "volumes" : "networks"]++;
      }
    }
  }
  const images = docker([
    "image",
    "ls",
    "--format",
    "{{.Repository}}:{{.Tag}}",
  ]);
  if (images !== undefined) {
    for (const tag of images.split("\n")) {
      const owner = /^((?:acceptance-api-)[a-f0-9]{8})-/.exec(tag)?.[1];
      if (!owner || !projects.has(owner)) continue;
      // Removing the owned tag preserves any unrelated tags of a shared image.
      if (docker(["image", "rm", tag]) !== undefined) removed.imageTags++;
    }
  }
  return { removed, failures, projects: projects.size };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await cleanupHardeningFixtures(process.argv[2], {
    discoverTemporaryOwners: true,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
