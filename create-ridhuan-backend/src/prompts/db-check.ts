import pg from "pg";

export type PostgresCheckResult =
  | { readonly status: "connected"; readonly message: string }
  | { readonly status: "unreachable" | "authentication_failed" | "database_missing" | "connection_failed"; readonly message: string };

export async function verifyPostgresConnection(host: string, port: number, user: string, password: string, database: string): Promise<PostgresCheckResult> {
  const client = new pg.Client({ host, port, user, password, database, connectionTimeoutMillis: 2500, query_timeout: 2500 });
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
