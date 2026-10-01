import { existsSync, readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

export type DatabaseProvider = "postgresql" | "mysql";

export function databaseProvider(): DatabaseProvider {
  const provider = process.env.DB_PROVIDER ?? "postgresql";
  if (provider !== "postgresql" && provider !== "mysql") throw new Error("Invalid DB_PROVIDER");
  return provider;
}

export function createDatabaseAdapter(url: string, provider: DatabaseProvider): PrismaPg | PrismaMariaDb {
  const parsed = new URL(url);
  if (!(provider === "mysql" ? ["mysql:"] : ["postgres:", "postgresql:"]).includes(parsed.protocol)) throw new Error("DATABASE_URL does not match DB_PROVIDER");
  if (existsSync("backend-template.json")) {
    const value: unknown = JSON.parse(readFileSync("backend-template.json", "utf8"));
    if (!value || typeof value !== "object" || !("databaseProvider" in value) || value.databaseProvider !== provider) throw new Error("DB_PROVIDER does not match generated project");
  }
  if (provider === "postgresql") return new PrismaPg({ connectionString: url, options: "-c timezone=UTC", connectionTimeoutMillis: 3000 });
  const acceptance = parsed.searchParams.get("sslaccept");
  if (acceptance !== null && acceptance !== "strict") throw new Error("MySQL TLS requires sslaccept=strict");
  const tls = acceptance === "strict" ? "verify-full" : parsed.searchParams.get("sslmode") ?? "disable";
  const certificate = parsed.searchParams.get("sslcert");
  if (certificate && tls !== "verify-full") throw new Error("sslcert requires verified TLS");
  if (!["disable", "verify-full"].includes(tls)) throw new Error("MySQL sslmode must be disable (local) or verify-full");
  return new PrismaMariaDb({ host: parsed.hostname, port: Number(parsed.port || "3306"), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database: decodeURIComponent(parsed.pathname.slice(1)), connectionLimit: 10, connectTimeout: 3000, acquireTimeout: 3000, timezone: "+00:00", initSql: "SET time_zone = '+00:00'", charset: "utf8mb4", ...(tls === "verify-full" ? { ssl: { rejectUnauthorized: true, ...(certificate ? { ca: readFileSync(certificate) } : {}) } } : {}) });
}
