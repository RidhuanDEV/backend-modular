import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateOpenApi } from "../docs/openapi.js";

const artifact = resolve("dist/docs/openapi.json");
const generated = JSON.stringify(generateOpenApi(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  const existing = await readFile(artifact, "utf8");
  if (existing !== generated) throw new Error("OpenAPI artifact is stale");
} else {
  await mkdir(resolve("dist/docs"), { recursive: true });
  await writeFile(artifact, generated);
}
