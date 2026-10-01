import pg from "pg";
import { createConnection, type Connection } from "mysql2/promise";
import type { DatabaseProvider } from "../types.js";

export interface DatabaseTlsOptions {
  readonly mode: "disable" | "verify-full";
  readonly ca?: string;
}

export type PostgresCheckResult =
  | { readonly status: "connected"; readonly message: string }
  | { readonly status: "unreachable" | "authentication_failed" | "database_missing" | "database_access_denied" | "connection_failed"; readonly message: string };

export async function verifyPostgresConnection(host: string, port: number, user: string, password: string, database: string, tls: DatabaseTlsOptions = { mode: "disable" }): Promise<PostgresCheckResult> {
  const client = new pg.Client({ host, port, user, password, database, connectionTimeoutMillis: 2500, query_timeout: 2500,
    ...(tls.mode === "verify-full" ? { ssl: { rejectUnauthorized: true, ...(tls.ca ? { ca: tls.ca } : {}) } } : {}) });
  client.on("error", () => { /* A disconnected diagnostic client has no request to fail. */ });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { status: "connected", message: "PostgreSQL credentials and database verified." };
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "28P01" || code === "28000") return { status: "authentication_failed", message: "PostgreSQL rejected these credentials." };
    if (code === "3D000") return { status: "database_missing", message: "Create the configured PostgreSQL database before migration." };
    if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(typeof code === "string" ? code : "")) {
      return { status: "unreachable", message: "PostgreSQL is unreachable at the configured host and port." };
    }
    return { status: "connection_failed", message: "PostgreSQL connection check failed. Verify the host, TLS settings, credentials and database." };
  } finally { await client.end().catch(() => undefined); }
}

export async function verifyDatabaseConnection(provider: DatabaseProvider, host: string, port: number, user: string, password: string, database: string, tls: DatabaseTlsOptions = { mode: "disable" }): Promise<PostgresCheckResult> {
  if (provider === "postgresql") return verifyPostgresConnection(host, port, user, password, database, tls);
  let connection: Connection | undefined;
  try {
    connection = await createConnection({ host, port, user, password, database, connectTimeout: 2500,
      ...(tls.mode === "verify-full" ? { ssl: { rejectUnauthorized: true, ...(tls.ca ? { ca: tls.ca } : {}) } } : {}) });
    await connection.query({ sql: "SELECT 1", timeout: 2500 });
    return { status: "connected", message: "MySQL credentials and database verified." };
  } catch (error: unknown) {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ER_ACCESS_DENIED_ERROR") return { status: "authentication_failed", message: "MySQL rejected these credentials." };
    if (code === "ER_BAD_DB_ERROR") return { status: "database_missing", message: "Create the configured MySQL database before migration." };
    if (code === "ER_DBACCESS_DENIED_ERROR") return { status: "database_access_denied", message: "MySQL denied access to this database. Verify that it exists and grant this application account access." };
    if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "PROTOCOL_SEQUENCE_TIMEOUT"].includes(typeof code === "string" ? code : "")) return { status: "unreachable", message: "MySQL is unreachable at the configured host and port." };
    return { status: "connection_failed", message: "MySQL connection check failed. Verify host, TLS settings, credentials and database." };
  } finally { if (connection) connection.destroy(); }
}
