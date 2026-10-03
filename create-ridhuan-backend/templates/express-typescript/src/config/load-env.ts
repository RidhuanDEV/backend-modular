import { readFileSync, existsSync } from "node:fs";
import { config } from "dotenv";

// Compose single quoted values escape apostrophes; dotenv retains that escape.
// Normalize just that quoted syntax while preserving injected process variables.
export function loadEnvironment(path = ".env"): void {
  if (!existsSync(path)) return;
  const existing = new Set(Object.keys(process.env));
  const loaded = config({ path, quiet: true });
  if (loaded.error) {
    throw new Error("Unable to read environment file");
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2]?.trim();
    if (!key || raw === undefined || existing.has(key)) continue;
    if (raw.startsWith("'") && raw.endsWith("'"))
      process.env[key] = raw.slice(1, -1).replaceAll("\\'", "'");
    else if (raw.startsWith('"') && raw.endsWith('"')) {
      const decoded: unknown = JSON.parse(raw.replaceAll("\\$", "$"));
      if (typeof decoded !== "string")
        throw new Error(`Invalid quoted environment key: ${key}`);
      process.env[key] = decoded;
    }
  }
}
