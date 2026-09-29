import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { endpointRegistry } from "../common/endpoint/endpoint.registry";

interface ContractEndpoint {
  id: string;
  method: string;
  path: string;
  permission?: string;
  status: number;
  audit: string;
  cache: string;
  rateLimit: string;
}

function contractEndpoint(value: unknown): value is ContractEndpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.method === "string" &&
    typeof item.path === "string" && (item.permission === undefined || typeof item.permission === "string") &&
    typeof item.status === "number" &&
    typeof item.audit === "string" && typeof item.cache === "string" && typeof item.rateLimit === "string";
}

export async function verifyContract(root: string): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(resolve(root, "contracts", "express-endpoints.json"), "utf8"));
  if (!raw || typeof raw !== "object" || !("endpoints" in raw) || !Array.isArray(raw.endpoints) ||
      !raw.endpoints.every(contractEndpoint)) throw new Error("Invalid Express contract fixture");
  const extensionRaw: unknown = JSON.parse(await readFile(resolve(root, "contracts", "notification-endpoints.json"), "utf8"));
  if (!extensionRaw || typeof extensionRaw !== "object" || !("endpoints" in extensionRaw) ||
      !Array.isArray(extensionRaw.endpoints) || !extensionRaw.endpoints.every(contractEndpoint))
    throw new Error("Invalid Notifications contract fixture");
  const expected = [...raw.endpoints as ContractEndpoint[], ...extensionRaw.endpoints as ContractEndpoint[]];
  if (expected.length !== Object.keys(endpointRegistry).length ||
      new Set(expected.map((entry) => entry.id)).size !== expected.length)
    throw new Error("Express baseline or notification extensions differ from NestJS");
  for (const endpoint of expected) {
    const actual = endpointRegistry[endpoint.id as keyof typeof endpointRegistry];
    if (!actual) throw new Error(`Missing NestJS endpoint: ${endpoint.id}`);
    for (const property of ["method", "path", "status", "audit", "cache", "rateLimit"] as const) {
      if (actual[property] !== endpoint[property]) throw new Error(`Express contract differs: ${endpoint.id}.${property}`);
    }
    if (endpoint.permission !== undefined && actual.permission !== endpoint.permission)
      throw new Error(`Express contract differs: ${endpoint.id}.permission`);
  }
}

if (require.main === module) verifyContract(process.cwd())
  .then(() => process.stdout.write("Express endpoint contract matches NestJS registry.\n"))
  .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Contract verification failed"}\n`); process.exitCode = 1; });
