// Runtime assertions against real HTTP and provider transactions in disposable fixtures.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import mysql from "mysql2/promise";
import { createConnection } from "node:net";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function verifyHardening({
  id,
  database,
  dbPort,
  dbUser,
  dbPassword,
  dbName,
  baseURL,
  credentials,
  jwtSecret,
  rootPassword,
  setAuditMode,
}) {
  const isMySQL = database === "mysql";
  const options = {
    host: "127.0.0.1",
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  };
  const connect = async () => {
    if (isMySQL) return mysql.createConnection({ ...options, timezone: "Z" });
    const connection = new pg.Client(options);
    await connection.connect();
    return connection;
  };
  const connection = await connect();
  const quote = (name) => (isMySQL ? "`" + name + "`" : '"' + name + '"');
  const camel = id === "express-typescript" || id === "nestjs";
  const dotnet = id === "dotnet";
  const field = (name) =>
    quote(
      dotnet
        ? name[0].toUpperCase() + name.slice(1)
        : camel
          ? name
          : name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()),
    );
  const names = {
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
    jobs: id === "express-typescript" ? "EmailJob" : "email_jobs",
    audit: id === "express-typescript" ? "CrudAuditLog" : "activity_logs",
    users: id === "express-typescript" ? "User" : "users",
  };
  const table = (name) => quote(names[name]);
  const query = async (sql, params = [], client = connection) => {
    let n = 0;
    const text = isMySQL ? sql : sql.replaceAll("?", () => "$" + ++n);
    const result = await client.query(text, params);
    return isMySQL ? result[0] : result.rows;
  };
  const request = async (
    path,
    { method = "GET", body, token, status = 200, headers = {} } = {},
  ) => {
    const response = await fetch(baseURL + path, {
      method,
      headers: {
        connection: "close",
        ...headers,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(
      response.status,
      status,
      `${id}/${database}: ${method} ${path} expected ${status}`,
    );
    if (status === 204) {
      assert.equal(await response.text(), "");
      return undefined;
    }
    return response.json();
  };
  const login = async () =>
    (await request("/api/auth/login", { method: "POST", body: credentials }))
      .data;
  const access = (pair) => pair[dotnet ? "accessToken" : "token"];
  const refresh = async (raw, status = 200) =>
    request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: raw },
      status,
    });
  const logout = async (raw) =>
    request("/api/auth/logout", {
      method: "POST",
      body: { refreshToken: raw },
      status: 204,
    });
  const hash = (raw) => {
    const digest = createHash("sha256").update(raw).digest();
    if (id === "golang") return digest;
    const value = digest.toString("hex");
    return dotnet ? value.toUpperCase() : value;
  };
  const tokenRow = async (raw) =>
    (
      await query(
        `SELECT ${field("familyId")} AS family,${field("revokedAt")} AS revoked,${field("expiresAt")} AS expiry FROM ${table("tokens")} WHERE ${field("tokenHash")}=?`,
        [hash(raw)],
      )
    )[0];
  const familyRow = async (family) =>
    (
      await query(
        `SELECT ${field("expiresAt")} AS expiry,${field("revokedAt")} AS revoked FROM ${table("families")} WHERE ${field("id")}=?`,
        [family],
      )
    )[0];
  const mark = "fixture_" + randomUUID().replaceAll("-", "");
  try {
    const first = await login();
    const jwt = JSON.parse(
      Buffer.from(access(first).split(".")[1], "base64url").toString(),
    );
    assert.equal(jwt.exp - (jwt.iat ?? jwt.nbf), 900, "Access token TTL");
    const me = (await request("/api/auth/me", { token: access(first) })).data;
    assert(!("password" in me));
    assert(!("passwordHash" in me));
    const original = await tokenRow(first.refreshToken);
    // An old creation date (and .NET's previous cap) must not cap the next rotation.
    const old = new Date(Date.now() - 120 * 86400000);
    await query(
      `UPDATE ${table("families")} SET ${field("createdAt")}=? WHERE ${field("id")}=?`,
      [old, original.family],
    );
    if (dotnet)
      await query(
        `UPDATE ${table("tokens")} SET ${field("familyExpiresAt")}=? WHERE ${field("familyId")}=?`,
        [new Date(Date.now() - 86400000), original.family],
      );
    const before = Date.now();
    const rotated = (await refresh(first.refreshToken)).data;
    const family = await familyRow(original.family);
    assert(
      Math.abs(new Date(family.expiry).getTime() - (before + 30 * 86400000)) <
        15000,
      "Sliding expiry must be server now +30 days",
    );
    assert((await tokenRow(first.refreshToken)).revoked);
    await logout(first.refreshToken);
    await logout(first.refreshToken);
    await refresh(rotated.refreshToken, 401);
    await pause(300); // Allow optional audit intents from preceding completed requests to flush.
    const countBefore = (
      await query(`SELECT COUNT(*) AS count FROM ${table("audit")}`)
    )[0].count;
    await logout(
      "unknown-fixture-refresh-token-value-that-is-at-least-32-characters",
    );
    assert.equal(
      String(
        (await query(`SELECT COUNT(*) AS count FROM ${table("audit")}`))[0]
          .count,
      ),
      String(countBefore),
      "Unknown logout produced a false audit mutation",
    );

    // Expired family/token cannot be revived.
    const expired = await login();
    const er = await tokenRow(expired.refreshToken);
    await query(
      `UPDATE ${table("families")} SET ${field("expiresAt")}=? WHERE ${field("id")}=?`,
      [new Date(Date.now() - 1000), er.family],
    );
    await refresh(expired.refreshToken, 401);
    assert(
      new Date((await familyRow(er.family)).expiry).getTime() < Date.now(),
    );
    const expiredToken = await login();
    await query(
      `UPDATE ${table("tokens")} SET ${field("expiresAt")}=? WHERE ${field("tokenHash")}=?`,
      [new Date(Date.now() - 1000), hash(expiredToken.refreshToken)],
    );
    await refresh(expiredToken.refreshToken, 401);

    // Consumed hash is retained even if its old token expiry has passed.
    const replay = await login();
    const replacement = (await refresh(replay.refreshToken)).data;
    await query(
      `UPDATE ${table("tokens")} SET ${field("expiresAt")}=? WHERE ${field("tokenHash")}=?`,
      [new Date(Date.now() - 1000), hash(replay.refreshToken)],
    );
    await refresh(replay.refreshToken, 401);
    await refresh(replacement.refreshToken, 401);

    // Hold the shared family lock while both requests reach the transaction.
    for (const operation of [
      "refresh-refresh",
      "refresh-logout",
      "logout-refresh",
    ]) {
      const session = await login();
      const row = await tokenRow(session.refreshToken);
      const blocker = await connect();
      await query("BEGIN", [], blocker);
      await query(
        `SELECT ${field("id")} FROM ${table("families")} WHERE ${field("id")}=? FOR UPDATE`,
        [row.family],
        blocker,
      );
      const rawRefresh = () =>
        fetch(baseURL + "/api/auth/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          signal: AbortSignal.timeout(15000),
        });
      const rawLogout = () =>
        fetch(baseURL + "/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          signal: AbortSignal.timeout(15000),
        });
      let requests;
      try {
        requests =
          operation === "refresh-refresh"
            ? [rawRefresh(), rawRefresh()]
            : operation === "refresh-logout"
              ? [rawRefresh(), rawLogout()]
              : [rawLogout(), rawRefresh()];
        await pause(200);
        await query("COMMIT", [], blocker);
      } finally {
        await blocker.end();
      }
      const results = await Promise.all(requests);
      assert.deepEqual(
        results.map((r) => r.status).sort(),
        operation === "refresh-refresh"
          ? [200, 401]
          : results.some((r) => r.status === 200)
            ? [200, 204]
            : [204, 401],
      );
      assert(
        (await familyRow(row.family)).revoked,
        "Concurrent operations revived the family",
      );
      for (const result of results)
        if (result.status === 200)
          await refresh((await result.json()).data.refreshToken, 401);
    }

    // Isolated recipient gives a deterministic unread backlog and page fixture.
    const recipientCredentials = {
      email: mark + "@example.test",
      password: "Hardening-fixture-password-45",
    };
    const recipient = (
      await request("/api/auth/register", {
        method: "POST",
        body: recipientCredentials,
        status: 201,
      })
    ).data;
    const recipientPair = (
      await request("/api/auth/login", {
        method: "POST",
        body: recipientCredentials,
      })
    ).data;
    const admin = await login();
    const create = async (number, sendEmail = false, status = 201) =>
      (
        await request("/api/notifications", {
          method: "POST",
          token: access(admin),
          body: {
            recipientId: recipient.id,
            title: mark + " " + number,
            body: "Ordered persisted notification fixture " + "x".repeat(3900),
            sendEmail,
          },
          status,
        })
      ).data;
    const events = [];
    for (let start = 0; start < 120; start += 4)
      events.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(4, 120 - start) }, (_, n) =>
            create(start + n),
          ),
        )),
      );
    const persisted = await query(
      `SELECT ${field("id")} AS id,${field("sequence")} AS sequence FROM ${table("notifications")} WHERE ${field("recipientId")}=? ORDER BY ${field("sequence")}`,
      [recipient.id],
    );
    assert.equal(
      new Set(persisted.map((row) => String(row.sequence))).size,
      120,
    );
    assert.deepEqual(
      persisted.map((row) => Number(row.sequence)),
      Array.from({ length: 120 }, (_, i) => i + 1),
    );
    async function stream(cursor, expected) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch(baseURL + "/api/notifications/stream", {
          headers: {
            authorization: `Bearer ${access(recipientPair)}`,
            ...(cursor ? { "Last-Event-ID": cursor } : {}),
          },
          signal: abort.signal,
        });
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-type"),
          /text\/event-stream/,
        );
        const reader = response.body.getReader();
        let text = "";
        const received = [];
        while (received.length < expected.length) {
          const part = await reader.read();
          assert(!part.done, "Stream ended before backlog drained");
          text += new TextDecoder().decode(part.value);
          while (text.includes("\n\n")) {
            const end = text.indexOf("\n\n");
            const event = text.slice(0, end);
            text = text.slice(end + 2);
            const value = /^id: (.+)$/m.exec(event)?.[1];
            if (value) received.push(value);
          }
        }
        assert.deepEqual(received, expected);
        await reader.cancel();
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    }
    await stream(
      undefined,
      persisted.map((row) => row.id),
    );
    // Pause the actual TCP reader during a large backlog, then disconnect it.
    const address = new URL(baseURL);
    const slow = createConnection({
      host: address.hostname,
      port: Number(address.port),
    });
    try {
      await new Promise((resolve, reject) => {
        let header = "";
        const timeout = setTimeout(
          () => reject(new Error("Slow SSE fixture did not receive headers")),
          10000,
        );
        slow.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        slow.once("connect", () =>
          slow.write(
            `GET /api/notifications/stream HTTP/1.1\r\nHost: ${address.host}\r\nAuthorization: Bearer ${access(recipientPair)}\r\nConnection: close\r\n\r\n`,
          ),
        );
        slow.on("data", (chunk) => {
          header += chunk.toString();
          if (header.includes("\r\n\r\n")) {
            clearTimeout(timeout);
            slow.pause();
            if (!/^HTTP\/1\.1 200/.test(header))
              reject(new Error("Slow SSE fixture was rejected"));
            else resolve();
          }
        });
      });
      await pause(1500);
      assert.equal(
        (await fetch(baseURL + "/ready", { signal: AbortSignal.timeout(3000) }))
          .status,
        200,
      );
      if (!isMySQL)
        assert.equal(
          Number(
            (
              await query(
                "SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname=? AND state='idle in transaction' AND xact_start < NOW()-INTERVAL '1 second'",
                [dbName],
              )
            )[0].count,
          ),
          0,
          "SSE held an idle database transaction for a slow client",
        );
    } finally {
      slow.destroy();
    }
    for (const row of persisted.slice(0, 69))
      await query(
        `UPDATE ${table("notifications")} SET ${field("readAt")}=? WHERE ${field("id")}=?`,
        [new Date(), row.id],
      );
    await stream(
      undefined,
      persisted.slice(69).map((row) => row.id),
    ); // Initial unread backlog across two batches (51).
    await query(
      `UPDATE ${table("notifications")} SET ${field("readAt")}=? WHERE ${field("id")}=?`,
      [new Date(), persisted[69].id],
    );
    await stream(
      persisted[68].id,
      persisted.slice(69).map((row) => row.id),
    ); // 51 after cursor, including one read row.
    await stream(
      undefined,
      persisted.slice(70).map((row) => row.id),
    );
    for (const cursor of [randomUUID(), events[0].id]) {
      const invalid = await fetch(baseURL + "/api/notifications/stream", {
        headers: {
          authorization: `Bearer ${access(first)}`,
          "Last-Event-ID": cursor,
        },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(invalid.status, 400);
      assert(
        !invalid.headers.get("content-type")?.startsWith("text/event-stream"),
      );
    }
    const listed = [];
    let cursor;
    do {
      const page = await fetch(
        baseURL + "/api/notifications" + (cursor ? "?cursor=" + cursor : ""),
        {
          headers: { authorization: `Bearer ${access(recipientPair)}` },
          signal: AbortSignal.timeout(10000),
        },
      );
      assert.equal(page.status, 200);
      listed.push(...(await page.json()).data.map((item) => item.id));
      cursor = page.headers.get("X-Next-Cursor");
    } while (cursor);
    assert.deepEqual(listed, persisted.map((row) => row.id).reverse());
    const originalParts = access(recipientPair).split(".");
    const shortClaims = JSON.parse(
      Buffer.from(originalParts[1], "base64url").toString(),
    );
    shortClaims.exp = Math.floor(Date.now() / 1000) + 3;
    const signingInput =
      originalParts[0] +
      "." +
      Buffer.from(JSON.stringify(shortClaims)).toString("base64url");
    const shortToken =
      signingInput +
      "." +
      createHmac("sha256", jwtSecret).update(signingInput).digest("base64url");
    const expires = await fetch(baseURL + "/api/notifications/stream", {
      headers: {
        authorization: `Bearer ${shortToken}`,
        "Last-Event-ID": persisted.at(-1).id,
      },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(expires.status, 200);
    const expiryReader = expires.body.getReader();
    while (!(await expiryReader.read()).done) {}
    const inactive = await fetch(baseURL + "/api/notifications/stream", {
      headers: {
        authorization: `Bearer ${access(recipientPair)}`,
        "Last-Event-ID": persisted.at(-1).id,
      },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(inactive.status, 200);
    await query(
      `UPDATE ${table("users")} SET ${field("deletedAt")}=? WHERE ${field("id")}=?`,
      [new Date(), recipient.id],
    );
    try {
      const reader = inactive.body.getReader();
      while (!(await reader.read()).done) {}
    } finally {
      await query(
        `UPDATE ${table("users")} SET ${field("deletedAt")}=NULL WHERE ${field("id")}=?`,
        [recipient.id],
      );
    }
    const disabled = await create("smtp-disabled", true);
    assert.equal(disabled.emailStatus, "FAILED");
    assert.equal(
      (
        await query(
          `SELECT COUNT(*) AS count FROM ${table("jobs")} WHERE ${field("notificationId")}=?`,
          [disabled.id],
        )
      )[0].count.toString(),
      "0",
    );
    const faultSession = await login();
    const faultRow = await tokenRow(faultSession.refreshToken);
    const trigger = quote(mark + "_audit");
    const functionName = quote(mark + "_fail");
    const condition = `NEW.${field("endpointId")} IN ('auth.refresh','auth.logout','notification.create')`;
    const faultAdmin = isMySQL
      ? await mysql.createConnection({
          ...options,
          user: "root",
          password: rootPassword,
          timezone: "Z",
        })
      : connection;
    if (isMySQL)
      await query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table("audit")} FOR EACH ROW BEGIN IF ${condition} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'; END IF; END`,
        [],
        faultAdmin,
      );
    else {
      await query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
      );
      await query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table("audit")} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
    }
    try {
      const failed = async (path, body, token) => {
        const response = await fetch(baseURL + path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        assert(
          response.status >= 500,
          `Required audit failure committed ${path}: ${response.status}`,
        );
      };
      await failed("/api/auth/refresh", {
        refreshToken: faultSession.refreshToken,
      });
      assert.equal(
        (await tokenRow(faultSession.refreshToken)).revoked,
        null,
        "Required audit failure consumed token",
      );
      assert.equal((await familyRow(faultRow.family)).revoked, null);
      await failed("/api/auth/logout", {
        refreshToken: faultSession.refreshToken,
      });
      assert.equal(
        (await familyRow(faultRow.family)).revoked,
        null,
        "Required audit failure revoked family",
      );
      const counter = (
        await query(
          `SELECT ${field("sequence")} AS sequence FROM ${table("counters")} WHERE ${field("recipientId")}=?`,
          [recipient.id],
        )
      )[0].sequence;
      await failed(
        "/api/notifications",
        {
          recipientId: recipient.id,
          title: "audit-rollback",
          body: "Rollback fixture",
          sendEmail: true,
        },
        access(admin),
      );
      assert.equal(
        String(
          (
            await query(
              `SELECT ${field("sequence")} AS sequence FROM ${table("counters")} WHERE ${field("recipientId")}=?`,
              [recipient.id],
            )
          )[0].sequence,
        ),
        String(counter),
        "Required audit failure allocated sequence",
      );
      assert.equal(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${table("notifications")} WHERE ${field("title")}=?`,
            ["audit-rollback"],
          )
        )[0].count.toString(),
        "0",
      );
      await setAuditMode("optional");
      const optional = (await refresh(faultSession.refreshToken)).data;
      assert(
        (await tokenRow(faultSession.refreshToken)).revoked,
        "Optional audit failure rolled back successful refresh",
      );
      await logout(faultSession.refreshToken);
      assert(
        (await familyRow(faultRow.family)).revoked,
        "Optional audit failure rolled back logout",
      );
      await refresh(optional.refreshToken, 401);
      await setAuditMode("required");
    } finally {
      await query(
        `DROP TRIGGER ${trigger}${isMySQL ? "" : " ON " + table("audit")}`,
        [],
        faultAdmin,
      );
      if (!isMySQL) await query(`DROP FUNCTION ${functionName}()`);
      else await faultAdmin.end();
    }
    await refresh((await login()).refreshToken);
    const snapshots = await query(
      `SELECT ${field("before")} AS previous,${field("after")} AS next FROM ${table("audit")} WHERE ${field("endpointId")} IN ('auth.refresh','auth.logout')`,
    );
    assert(snapshots.length > 0, "Session audit producer absent");
    for (const row of snapshots)
      assert(
        !/tokenHash|token_hash|refreshToken|password/i.test(
          JSON.stringify(row),
        ),
        "Sensitive value in audit snapshot",
      );
    console.log(
      `${id}/${database}: sliding session, expired/replayed hashes, consumed logout, family-lock concurrency, required-audit rollback, 120/51 SSE backlog, cursor isolation, pagination and SMTP-disabled outbox passed`,
    );
  } finally {
    await connection.end();
  }
}
