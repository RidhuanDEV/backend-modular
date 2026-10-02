import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import mysql from "mysql2/promise";

// Upgrade starts at the LAST released schema, with actual session and notification history.
export async function verifyHardeningUpgrade({
  project,
  id,
  database,
  dbPort,
  envValue,
  env,
  dbPassword,
  run,
}) {
  const isMySQL = database === "mysql";
  const dotnet = id === "dotnet";
  const camel = id === "express-typescript" || id === "nestjs";
  const name = "hardening_upgrade_" + randomUUID().replaceAll("-", "");
  const password = isMySQL ? envValue(env, "MYSQL_ROOT_PASSWORD") : dbPassword;
  const user = isMySQL ? "root" : envValue(env, "POSTGRES_USER");
  const config = { host: "127.0.0.1", port: dbPort, user, password };
  const connect = async (databaseName) => {
    if (isMySQL)
      return mysql.createConnection({
        ...config,
        database: databaseName,
        timezone: "Z",
        multipleStatements: true,
      });
    const client = new pg.Client({ ...config, database: databaseName });
    await client.connect();
    return client;
  };
  const admin = await connect(isMySQL ? "mysql" : "postgres");
  let connection;
  const q = (name) => (isMySQL ? "`" + name + "`" : '"' + name + '"');
  const f = (name) =>
    q(
      dotnet
        ? name[0].toUpperCase() + name.slice(1)
        : camel
          ? name
          : name.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
    );
  const tables = {
    users: id === "express-typescript" ? "User" : "users",
    roles: id === "express-typescript" ? "Role" : "roles",
    tokens:
      id === "express-typescript"
        ? "RefreshToken"
        : id === "golang"
          ? "auth_refresh_tokens"
          : "refresh_tokens",
    families:
      id === "express-typescript" ? "RefreshFamily" : "refresh_families",
    notifications:
      id === "express-typescript" ? "Notification" : "notifications",
    counters:
      id === "express-typescript"
        ? "NotificationCounter"
        : "notification_counters",
  };
  const t = (name) => q(tables[name]);
  const query = async (sql, params = [], client = connection) => {
    let i = 0;
    const result = await client.query(
      isMySQL ? sql : sql.replaceAll("?", () => "$" + ++i),
      params,
    );
    return isMySQL ? result[0] : result.rows;
  };
  const insert = async (table, row) =>
    query(
      `INSERT INTO ${t(table)} (${Object.keys(row).map(f).join(",")}) VALUES (${Object.keys(
        row,
      )
        .map(() => "?")
        .join(",")})`,
      Object.values(row),
    );
  try {
    await query("CREATE DATABASE " + q(name), [], admin);
    connection = await connect(name);
    const base =
      id === "express-typescript" ? "docker-compose.yml" : "compose.yaml";
    const raw = envValue(
      env,
      dotnet ? "Database__ConnectionString_DOCKER" : "DATABASE_URL_DOCKER",
    );
    let releaseEnv;
    if (dotnet) {
      let connectionString = raw.replace(
        /Database=(?:"[^"]+"|[^;]+)/i,
        "Database=" + name,
      );
      if (isMySQL)
        connectionString = connectionString
          .replace(/User ID=(?:"[^"]+"|[^;]+)/i, "User ID=root")
          .replace(
            /Password=(?:"(?:[^"]|"")*"|[^;]+)/i,
            "Password=" + password,
          );
      releaseEnv = "Database__ConnectionString=" + connectionString;
    } else {
      const url = new URL(raw);
      url.pathname = "/" + name;
      if (isMySQL) {
        url.username = "root";
        url.password = password;
      }
      releaseEnv = "DATABASE_URL=" + url.toString();
    }
    const release = (entry, ...args) =>
      run(
        "docker",
        [
          "compose",
          "-f",
          base,
          "-f",
          ".tmp-consumer-ports.yaml",
          "run",
          "--rm",
          "--no-deps",
          "-e",
          releaseEnv,
          "--entrypoint",
          entry,
          "migrate",
          ...args,
        ],
        project,
        false,
      );
    if (camel) {
      const root = join(
        project,
        "prisma",
        isMySQL ? "mysql/migrations" : "migrations",
      );
      for (const migration of (await readdir(root))
        .filter((n) => /^\d/.test(n) && !n.includes("hardening"))
        .sort()) {
        await query(
          await readFile(join(root, migration, "migration.sql"), "utf8"),
        );
        release(
          "node",
          "node_modules/prisma/build/index.js",
          "migrate",
          "resolve",
          "--applied",
          migration,
        );
      }
    } else if (id === "golang")
      release("migrate", "--to-version", isMySQL ? "3" : "4");
    else if (id === "fastapi")
      release("backend", "migrate", "--revision", "0002");
    else
      release(
        "dotnet",
        "/app/migrator/AcceptanceApi.Migrator.dll",
        "--to-migration",
        isMySQL
          ? "20261001053005_InitialMySqlSchema"
          : "20260929052522_AddNotifications",
      );
    const role = randomUUID(),
      userID = randomUUID(),
      created = new Date(Date.now() - 120 * 86400000);
    await insert("roles", {
      id: role,
      name: "hardening-upgrade",
      createdAt: created,
      updatedAt: created,
      ...(dotnet && isMySQL ? { version: 0 } : {}),
    });
    await insert("users", {
      id: userID,
      email: "hardening-upgrade@example.test",
      [camel || id === "golang" ? "password" : "passwordHash"]:
        "not-a-login-hash",
      roleId: role,
      createdAt: created,
      updatedAt: created,
      ...(dotnet && isMySQL ? { version: 0 } : {}),
    });
    const fixtures = [];
    for (const state of ["active", "expired", "revoked", "rotated"]) {
      const family = randomUUID();
      const expiry = new Date(
        Date.now() + (state === "expired" ? -2 : 20) * 86400000,
      );
      const revoked =
        state === "revoked" ? new Date(Date.now() - 86400000) : null;
      const digest = createHash("sha256")
        .update("fixture-" + family)
        .digest();
      const hash = id === "golang" ? digest : digest.toString("hex");
      await insert("tokens", {
        id: randomUUID(),
        tokenHash: dotnet ? hash.toUpperCase() : hash,
        familyId: family,
        userId: userID,
        expiresAt: expiry,
        revokedAt: revoked,
        createdAt: created,
        ...(dotnet ? { familyExpiresAt: new Date(Date.now() - 86400000) } : {}),
      });
      if (state === "rotated")
        await insert("tokens", {
          id: randomUUID(),
          tokenHash: id === "golang" ? Buffer.alloc(32, 0xaa) : "a".repeat(64),
          familyId: family,
          userId: userID,
          expiresAt: new Date(Date.now() - 86400000),
          revokedAt: new Date(Date.now() - 2 * 86400000),
          createdAt: created,
          ...(dotnet
            ? { familyExpiresAt: new Date(Date.now() - 86400000) }
            : {}),
        });
      fixtures.push({ family, expiry, revoked, state });
    }
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    for (const [i, idValue] of ids.entries())
      await insert("notifications", {
        id: idValue,
        recipientId: userID,
        title: "Legacy " + i,
        body: "Preserve history",
        emailStatus: "PENDING",
        createdAt: created,
        ...(id === "fastapi" ? { sequence: [8, 20, 30][i] } : {}),
      });
    const deploy = () =>
      camel
        ? release(
            "node",
            "node_modules/prisma/build/index.js",
            "migrate",
            "deploy",
          )
        : id === "golang"
          ? release("migrate")
          : id === "fastapi"
            ? release("backend", "migrate")
            : release("dotnet", "/app/migrator/AcceptanceApi.Migrator.dll");
    deploy();
    deploy();
    for (const fixture of fixtures) {
      const row = (
        await query(
          `SELECT ${f("expiresAt")} AS expiry,${f("revokedAt")} AS revoked FROM ${t("families")} WHERE ${f("id")}=?`,
          [fixture.family],
        )
      )[0];
      assert(row, "Missing legacy family");
      assert(
        Math.abs(new Date(row.expiry).getTime() - fixture.expiry.getTime()) <
          1000,
      );
      assert.equal(Boolean(row.revoked), fixture.state === "revoked");
    }
    const rows = await query(
      `SELECT ${f("id")} AS id,${f("sequence")} AS sequence,${f("emailStatus")} AS status FROM ${t("notifications")} WHERE ${f("recipientId")}=? ORDER BY ${f("sequence")}`,
      [userID],
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      ids,
    );
    assert.deepEqual(
      rows.map((row) => Number(row.sequence)),
      id === "fastapi" ? [8, 20, 30] : [1, 2, 3],
    );
    assert(rows.every((row) => row.status === "FAILED"));
    assert.equal(
      Number(
        (
          await query(
            `SELECT ${f("sequence")} AS sequence FROM ${t("counters")} WHERE ${f("recipientId")}=?`,
            [userID],
          )
        )[0].sequence,
      ),
      id === "fastapi" ? 30 : 3,
    );
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("tokens")} WHERE ${f("userId")}=?`,
            [userID],
          )
        )[0].count,
      ),
      5,
    );
    console.log(
      `${id}/${database}: last-release upgrade preserves active/expired/revoked/rotated families, hashes and notification sequence; repeat migration passed`,
    );
  } finally {
    await connection?.end();
    await query(
      "DROP DATABASE IF EXISTS " + q(name) + (isMySQL ? "" : " WITH (FORCE)"),
      [],
      admin,
    );
    await admin.end();
  }
}
