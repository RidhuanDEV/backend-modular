import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
if (!output.startsWith(root + sep)) throw new Error("Invalid build directory");
await rm(output, { recursive: true, force: true });
