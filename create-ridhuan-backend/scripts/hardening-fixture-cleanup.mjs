import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { command } from "../dist/process.js";

// Ownership comes from this task's recorded logs, never from a global prune.
export async function cleanupHardeningFixtures(
  logDirectory = tmpdir(),
) {
  const projects = new Set();
  const manualLaravel = new Set();
  for (const entry of await readdir(logDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:hardening-|manual-|compose-).*\.log$/.test(entry.name)) continue;
    const log = await readFile(join(logDirectory, entry.name), "utf8");
    for (const match of log.matchAll(/^LARAVEL_MANUAL_OWNER=(laravel-manual-[a-f0-9]{8})\s*$/gm)) manualLaravel.add(match[1]);
    for (const match of log.matchAll(/\b(?:acceptance-api-[a-f0-9]{8}|spring-[a-f0-9]{32}|laravel-acceptance-[a-f0-9]{8})\b/g))
      projects.add(match[0]);
    for (const match of log.matchAll(/^SPRING_FIXTURE=(.+)$/gm)) {
      const fixture = resolve(match[1].trim());
      const parts = relative(resolve(tmpdir()), fixture).split(sep);
      if (parts.length !== 1 || !/^spring-runtime-(?:postgresql|mysql)-[a-zA-Z0-9]+$/.test(parts[0])) continue;
      const ownership = JSON.parse(await readFile(join(fixture, "ownership.json"), "utf8"));
      if (typeof ownership.owner !== "string" || !/^spring-[a-f0-9]{32}$/.test(ownership.owner) || resolve(ownership.project) !== join(fixture, "runtime-java")) throw new Error("Invalid Spring fixture ownership");
      projects.add(ownership.owner);
    }
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
  const inventories=[];
  for (const owner of manualLaravel) {
    const scoped=docker(["ps","-a","--filter","label=ridhuan.laravel.fixture="+owner,"--format","{{.ID}}"]);
    if(scoped===undefined) continue;
    for(const id of scoped.split("\n").filter(Boolean)) {
      const inspected=docker(["inspect",id]); if(!inspected) continue;
      if(JSON.parse(inspected)[0].Config?.Labels?.["ridhuan.laravel.fixture"]!==owner) throw new Error("Manual fixture ownership changed");
      if(docker(["rm","-f","-v",id])!==undefined) removed.containers++;
    }
    const left=docker(["ps","-a","--filter","label=ridhuan.laravel.fixture="+owner,"--format","{{.ID}}"]);
    if(left===undefined||left.trim()) failures.push({operation:"verify manual containers",owner});
  }
  for(const owner of projects){const scoped=docker(["ps","-a","--filter","label=com.docker.compose.project="+owner,"--format","{{json .}}"]);if(scoped!==undefined)inventories.push(scoped);}
  const inventory=inventories.join("\n");
  for (const line of inventory.split("\n").filter(Boolean)) {
    const item = JSON.parse(line);
    if (typeof item.ID !== "string")
      throw new Error("Invalid Docker container inventory");
    const inspected = docker(["inspect", item.ID]);
    if (!inspected) continue;
    const container = JSON.parse(inspected)[0];
    const owner = container.Config?.Labels?.["com.docker.compose.project"];
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
      const owner = /^((?:acceptance-api-|laravel-acceptance-)[a-f0-9]{8}|spring-[a-f0-9]{32})-/.exec(tag)?.[1];
      if (!owner || !projects.has(owner)) continue;
      // Removing the owned tag preserves any unrelated tags of a shared image.
      if (docker(["image", "rm", tag]) !== undefined) removed.imageTags++;
    }
  }
  for (const owner of projects) {
    for (const [kind, args] of [['containers',['ps','-a']], ['volumes',['volume','ls']], ['networks',['network','ls']]]) {
      const remaining=docker([...args,'--filter','label=com.docker.compose.project='+owner,'--format',kind==='containers'?'{{.ID}}':'{{.Name}}']);
      if(remaining === undefined || remaining.trim()) failures.push({operation:'verify '+kind,owner});
    }
  }
  return { removed, failures, projects: projects.size };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await cleanupHardeningFixtures(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
