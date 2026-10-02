import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import mysql from "mysql2/promise";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function verifyWorkerRetention({
  id,
  database,
  dbPort,
  dbUser,
  dbPassword,
  dbName,
  baseURL,
  token,
  recipientId,
  smtpURL,
  compose,
  cleanup,
  cleanupConcurrent,
  stopWorkers,
  auditCleanup,
  rootPassword,
}) {
  const isMySQL = database === "mysql",
    dotnet = id === "dotnet",
    camel = id === "express-typescript" || id === "nestjs";
  const config = {
    host: "127.0.0.1",
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
  };
  const connection = isMySQL
    ? await mysql.createConnection({ ...config, timezone: "Z" })
    : new pg.Client(config);
  if (!isMySQL) await connection.connect();
  const q = (name) => (isMySQL ? "`" + name + "`" : '"' + name + '"');
  const f = (name) =>
    q(
      dotnet
        ? name[0].toUpperCase() + name.slice(1)
        : camel
          ? name
          : name.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
    );
  const t = (name) =>
    q(
      id === "express-typescript"
        ? {
            files: "StoredFile",
            jobs: "EmailJob",
            notifications: "Notification",
            users: "User",
            families: "RefreshFamily",
            tokens: "RefreshToken",
            audit: "CrudAuditLog",
          }[name]
        : {
            files: "stored_files",
            jobs: "email_jobs",
            notifications: "notifications",
            users: "users",
            families: "refresh_families",
            tokens: id === "golang" ? "auth_refresh_tokens" : "refresh_tokens",
            audit: "activity_logs",
          }[name],
    );
  const query = async (sql, params = []) => {
    let i = 0;
    const result = await connection.query(
      isMySQL ? sql : sql.replaceAll("?", () => "$" + ++i),
      params,
    );
    return isMySQL ? result[0] : result.rows;
  };
  const sink = async () =>
    (await fetch(smtpURL, { signal: AbortSignal.timeout(3000) })).json();
  const mode = async (value) =>
    assert(
      (await fetch(smtpURL + "/mode?value=" + value, { method: "POST" })).ok,
    );
  const create = async (label) => {
    const response = await fetch(baseURL + "/api/notifications", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipientId,
        title: label,
        body: "Immutable worker snapshot",
        sendEmail: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 201);
    const item = (await response.json()).data;
    assert.equal(item.emailStatus, "PENDING");
    return item;
  };
  const job = async (notification) =>
    (
      await query(
        `SELECT ${f("id")} AS id,${f("status")} AS status,${f("attempts")} AS attempts,${f("availableAt")} AS available,${f("leaseId")} AS lease,${f("leaseUntil")} AS expiry,${f("recipient")} AS recipient,${f("title")} AS title FROM ${t("jobs")} WHERE ${f("notificationId")}=?`,
        [notification],
      )
    )[0];
  // Include the 25-second bounded SMTP attempt plus the worker polling interval.
  async function until(probe, message) {
    for (let i = 0; i < 200; i++) {
      const value = await probe();
      if (value) return value;
      await pause(200);
    }
    throw new Error(message);
  }
  try {
    // API commits a durable snapshot while workers are stopped.
    compose("stop", "worker");
    // With SMTP enabled, failure of required audit must roll back the notification AND outbox.
    const atomicTitle = "atomic-outbox-" + randomUUID();
    const trigger = q("atomic_" + randomUUID().replaceAll("-", ""));
    const fail = q("fail_" + randomUUID().replaceAll("-", ""));
    const administrator = isMySQL
      ? await mysql.createConnection({
          ...config,
          user: "root",
          password: rootPassword,
          timezone: "Z",
        })
      : connection;
    const ddl = async (sql) => administrator.query(sql);
    if (isMySQL)
      await ddl(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${t("audit")} FOR EACH ROW BEGIN IF NEW.${f("endpointId")}='notification.create' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='atomic outbox fixture'; END IF; END`,
      );
    else {
      await ddl(
        `CREATE FUNCTION ${fail}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${f("endpointId")}='notification.create' THEN RAISE EXCEPTION 'atomic outbox fixture'; END IF; RETURN NEW; END $$`,
      );
      await ddl(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${t("audit")} FOR EACH ROW EXECUTE FUNCTION ${fail}()`,
      );
    }
    try {
      const blocked = await fetch(baseURL + "/api/notifications", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientId,
          title: atomicTitle,
          body: "Roll back both records",
          sendEmail: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      assert(
        blocked.status >= 500,
        "Required audit failure committed an SMTP notification",
      );
      for (const table of ["notifications", "jobs"])
        assert.equal(
          Number(
            (
              await query(
                `SELECT COUNT(*) AS count FROM ${t(table)} WHERE ${f("title")}=?`,
                [atomicTitle],
              )
            )[0].count,
          ),
          0,
          "Atomic outbox rollback failed for " + table,
        );
    } finally {
      await ddl(
        `DROP TRIGGER ${trigger}` + (isMySQL ? "" : ` ON ${t("audit")}`),
      );
      if (!isMySQL) await ddl(`DROP FUNCTION ${fail}()`);
      else await administrator.end();
    }
    const storedEmail = (
      await query(
        `SELECT ${f("email")} AS email FROM ${t("users")} WHERE ${f("id")}=?`,
        [recipientId],
      )
    )[0].email;
    const snapshot = await create("immutable-snapshot");
    const initial = await job(snapshot.id);
    assert.equal(initial.attempts, 0);
    assert.equal(initial.recipient, storedEmail);
    await query(`UPDATE ${t("users")} SET ${f("email")}=? WHERE ${f("id")}=?`, [
      "changed-worker@example.test",
      recipientId,
    ]);
    await query(
      `UPDATE ${t("notifications")} SET ${f("title")}=? WHERE ${f("id")}=?`,
      ["changed-title", snapshot.id],
    );
    const baseline = (await sink()).messages;
    compose("up", "-d", "--no-deps", "--scale", "worker=2", "worker");
    try {
      await until(
        async () => (await job(snapshot.id))?.status === "SENT",
        "Snapshot delivery failed",
      );
    } catch (error) {
      const row = await job(snapshot.id);
      console.error("Snapshot job state", {
        status: row?.status,
        attempts: row?.attempts,
        leaseUntil: row?.expiry,
      });
      throw error;
    }
    const delivered = await sink();
    assert.equal(delivered.messages, baseline + 1);
    assert(delivered.receipts.at(-1).recipient.includes(storedEmail));
    assert(delivered.receipts.at(-1).payload.includes("immutable-snapshot"));
    await query(`UPDATE ${t("users")} SET ${f("email")}=? WHERE ${f("id")}=?`, [
      storedEmail,
      recipientId,
    ]);
    // Multiple worker processes must claim each job once during ordinary delivery.
    const start = (await sink()).messages;
    const notifications = [];
    for (let i = 0; i < 8; i++)
      notifications.push(await create("parallel-worker-" + i));
    await until(async () => {
      for (const item of notifications)
        if ((await job(item.id)).status !== "SENT") return false;
      return true;
    }, "Multiple worker delivery failed");
    assert.equal((await sink()).messages, start + 8);
    for (const item of notifications)
      assert.equal((await job(item.id)).attempts, 1);

    await mode("fail");
    const failure = await create("retry-failure");
    for (let attempt = 1; attempt <= 5; attempt++) {
      const current = await until(async () => {
        const row = await job(failure.id);
        return row.attempts === attempt &&
          row.status === (attempt === 5 ? "FAILED" : "PENDING")
          ? row
          : false;
      }, "Retry transition missing at " + attempt);
      if (attempt < 5) {
        const delay =
          (new Date(current.available).getTime() - Date.now()) / 1000;
        assert(
          delay <= [5, 30, 120, 600][attempt - 1] + 2 &&
            delay >= [5, 30, 120, 600][attempt - 1] - 4,
          "Incorrect retry schedule",
        );
        await query(
          `UPDATE ${t("jobs")} SET ${f("availableAt")}=? WHERE ${f("id")}=?`,
          [new Date(Date.now() - 1000), current.id],
        );
      }
    }
    assert.equal(
      (
        await query(
          `SELECT ${f("emailStatus")} AS status FROM ${t("notifications")} WHERE ${f("id")}=?`,
          [failure.id],
        )
      )[0].status,
      "FAILED",
    );
    await mode("normal");
    // Recovery after a transient SMTP outage keeps the same unique outbox record.
    await mode("fail");
    const transient = await create("retry-recovery");
    const pending = await until(async () => {
      const row = await job(transient.id);
      return row.attempts === 1 && row.status === "PENDING" ? row : false;
    }, "Transient failure not retried");
    await mode("normal");
    await query(
      `UPDATE ${t("jobs")} SET ${f("availableAt")}=? WHERE ${f("id")}=?`,
      [new Date(Date.now() - 1000), pending.id],
    );
    await until(
      async () => (await job(transient.id)).status === "SENT",
      "SMTP recovery failed",
    );
    assert.equal((await job(transient.id)).attempts, 2);

    // A delivery near the SMTP deadline must renew its lease before completing.
    await mode("hold");
    const renewal = await create("lease-renewal");
    await until(
      async () => (await sink()).waiting > 0,
      "Renewal fixture did not reach SMTP",
    );
    const firstLease = await job(renewal.id);
    for (let i = 0; i < 115; i++) {
      const current = await job(renewal.id);
      if (
        new Date(current.expiry).getTime() >
        new Date(firstLease.expiry).getTime() + 10000
      )
        break;
      if (i === 114)
        throw new Error("Worker lease was not renewed at 20 seconds");
      await pause(200);
    }
    assert((await fetch(smtpURL + "/resume", { method: "POST" })).ok);
    await until(
      async () => (await job(renewal.id)).status === "SENT",
      "Renewed delivery did not complete",
    );
    assert.equal((await job(renewal.id)).attempts, 1);

    await mode("hold");
    const graceful = await create("graceful-stop");
    await until(
      async () => (await sink()).waiting > 0,
      "Graceful fixture did not reach SMTP",
    );
    const shutdown = stopWorkers();
    await pause(1000);
    const unclaimed = await create("stop-claiming");
    assert((await fetch(smtpURL + "/resume", { method: "POST" })).ok);
    await shutdown;
    assert.equal(
      (await job(graceful.id)).status,
      "SENT",
      "Graceful shutdown lost an in-flight acknowledgement",
    );
    assert.equal(
      (await job(unclaimed.id)).status,
      "PENDING",
      "Worker claimed new work after shutdown",
    );
    compose("up", "-d", "--no-deps", "--scale", "worker=2", "worker");
    await until(
      async () => (await job(unclaimed.id)).status === "SENT",
      "Pending shutdown job did not recover",
    );

    // Losing the lease while SMTP is in flight must fence the stale completion.
    await mode("hold");
    const fenced = await create("fenced-owner");
    await until(
      async () => (await sink()).waiting > 0,
      "Fence fixture did not reach SMTP",
    );
    const owner = await job(fenced.id);
    const newLease = randomUUID();
    await query(
      `UPDATE ${t("jobs")} SET ${f("leaseId")}=?,${f("leaseUntil")}=? WHERE ${f("id")}=?`,
      [newLease, new Date(Date.now() + 60000), owner.id],
    );
    assert((await fetch(smtpURL + "/resume", { method: "POST" })).ok);
    await pause(1000);
    assert.equal(
      (await job(fenced.id)).status,
      "PROCESSING",
      "Stale worker completed a job after losing its lease",
    );
    assert.equal(
      (
        await query(
          `SELECT ${f("emailStatus")} AS status FROM ${t("notifications")} WHERE ${f("id")}=?`,
          [fenced.id],
        )
      )[0].status,
      "PENDING",
    );
    await query(
      `UPDATE ${t("jobs")} SET ${f("leaseUntil")}=? WHERE ${f("id")}=?`,
      [new Date(Date.now() - 1000), owner.id],
    );
    await until(
      async () => (await job(fenced.id)).status === "SENT",
      "Fenced job was not recovered",
    );
    assert.equal((await job(fenced.id)).attempts, 2);

    // Crash after SMTP receipt, before acknowledgement/completion: at least once recovery.
    await mode("hold");
    const abandoned = await create("abandoned-lease");
    await until(
      async () => (await sink()).waiting > 0,
      "Worker did not reach SMTP acceptance",
    );
    const claimed = await job(abandoned.id);
    assert.equal(claimed.status, "PROCESSING");
    compose("kill", "worker");
    await query(
      `UPDATE ${t("jobs")} SET ${f("leaseUntil")}=? WHERE ${f("id")}=?`,
      [new Date(Date.now() - 1000), claimed.id],
    );
    await mode("normal");
    compose("up", "-d", "--no-deps", "--scale", "worker=2", "worker");
    await until(
      async () => (await job(abandoned.id)).status === "SENT",
      "Lease was not reclaimed after crash",
    );
    assert.equal((await job(abandoned.id)).attempts, 2);
    // A final abandoned attempt must become FAILED without a sixth SMTP send.
    compose("stop", "worker");
    const final = await create("abandoned-final");
    const finalJob = await job(final.id);
    await query(
      `UPDATE ${t("jobs")} SET ${f("status")}='PROCESSING',${f("attempts")}=5,${f("leaseId")}=?,${f("leaseUntil")}=? WHERE ${f("id")}=?`,
      [randomUUID(), new Date(Date.now() - 1000), finalJob.id],
    );
    const finalBaseline = (await sink()).messages;
    compose("up", "-d", "--no-deps", "--scale", "worker=2", "worker");
    await until(
      async () => (await job(final.id)).status === "FAILED",
      "Final abandoned claim was not failed",
    );
    assert.equal((await job(final.id)).attempts, 5);
    assert.equal((await sink()).messages, finalBaseline);
    compose("stop", "worker");

    // A referenced old object and a fresh orphan survive cleanup; only the old orphan is removed.
    const localForm = new FormData();
    localForm.append(
      "file",
      new Blob(["%PDF-1.4\nretention-fixture"], { type: "application/pdf" }),
      "retention.pdf",
    );
    const localUpload = await fetch(baseURL + "/api/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: localForm,
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(localUpload.status, 201);
    const localId = (await localUpload.json()).data.id;
    const reference = (
      await query(
        `SELECT ${f("objectKey")} AS storage_key FROM ${t("files")} WHERE ${f("id")}=?`,
        [localId],
      )
    )[0].storage_key;
    assert.match(
      reference,
      id === "fastapi" ? /^[0-9a-f-]{36}\.pdf$/i : /^[0-9a-f-]{36}$/i,
    );
    const extension = id === "fastapi" ? ".pdf" : "";
    const orphan = randomUUID() + extension,
      fresh = randomUUID() + extension;
    compose(
      "exec",
      "-T",
      "app",
      "sh",
      "-c",
      `printf fixture > /app/uploads/${orphan}; printf fixture > /app/uploads/${fresh}; touch -t 202601010000 /app/uploads/${orphan} /app/uploads/${reference}`,
    );
    // Retention never deletes active-family consumed hashes or pending work.
    const old = new Date(Date.now() - 40 * 86400000);
    const activeFamily = randomUUID(),
      expiredFamily = randomUUID(),
      revokedFamily = randomUUID();
    const insert = async (table, row) =>
      query(
        `INSERT INTO ${t(table)} (${Object.keys(row).map(f).join(",")}) VALUES (${Object.keys(
          row,
        )
          .map(() => "?")
          .join(",")})`,
        Object.values(row),
      );
    for (const [family, expiry, revoked] of [
      [activeFamily, new Date(Date.now() + 86400000), null],
      [expiredFamily, old, null],
      [revokedFamily, new Date(Date.now() + 86400000), old],
    ]) {
      await insert("families", {
        id: family,
        userId: recipientId,
        expiresAt: expiry,
        revokedAt: revoked,
        createdAt: old,
      });
      const digest = createHash("sha256").update(family).digest();
      await insert("tokens", {
        id: randomUUID(),
        familyId: family,
        userId: recipientId,
        tokenHash: id === "golang" ? digest : digest.toString("hex"),
        expiresAt: old,
        revokedAt: old,
        createdAt: old,
        ...(dotnet ? { familyExpiresAt: old } : {}),
      });
    }
    await query(
      `UPDATE ${t("jobs")} SET ${f("completedAt")}=? WHERE ${f("id")}=?`,
      [old, initial.id],
    );
    const retained = await create("retain-pending");
    const retainedJob = await job(retained.id);
    await query(
      `UPDATE ${t("jobs")} SET ${f("createdAt")}=? WHERE ${f("id")}=?`,
      [old, retainedJob.id],
    );
    await query(`UPDATE ${t("audit")} SET ${f("createdAt")}=?`, [
      new Date(Date.now() - 400 * 86400000),
    ]);
    const auditCount = Number(
      (await query(`SELECT COUNT(*) AS count FROM ${t("audit")}`))[0].count,
    );
    cleanup(false);
    for (const key of [orphan, fresh, reference])
      compose("exec", "-T", "app", "test", "-f", "/app/uploads/" + key);
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("families")} WHERE ${f("id")} IN (?,?,?)`,
            [activeFamily, expiredFamily, revokedFamily],
          )
        )[0].count,
      ),
      3,
    );
    assert(await job(snapshot.id), "Dry-run deleted outbox");
    await cleanupConcurrent();
    cleanup(true);
    compose("exec", "-T", "app", "test", "!", "-e", "/app/uploads/" + orphan);
    for (const key of [fresh, reference])
      compose("exec", "-T", "app", "test", "-f", "/app/uploads/" + key);
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("families")} WHERE ${f("id")} IN (?,?,?)`,
            [activeFamily, expiredFamily, revokedFamily],
          )
        )[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("tokens")} WHERE ${f("familyId")}=?`,
            [activeFamily],
          )
        )[0].count,
      ),
      1,
    );
    assert.equal(await job(snapshot.id), undefined);
    assert.equal((await job(retained.id)).status, "PENDING");
    assert.equal(
      Number(
        (await query(`SELECT COUNT(*) AS count FROM ${t("audit")}`))[0].count,
      ),
      auditCount,
      "Audit retention was enabled by default",
    );
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("notifications")} WHERE ${f("id")}=?`,
            [snapshot.id],
          )
        )[0].count,
      ),
      1,
    );
    auditCleanup(false, false);
    auditCleanup(true, false);
    assert.equal(
      Number(
        (await query(`SELECT COUNT(*) AS count FROM ${t("audit")}`))[0].count,
      ),
      auditCount,
      "Explicit dry-run deleted audit",
    );
    auditCleanup(true, true);
    assert.equal(
      Number(
        (
          await query(
            `SELECT COUNT(*) AS count FROM ${t("audit")} WHERE ${f("createdAt")}<?`,
            [new Date(Date.now() - 365 * 86400000)],
          )
        )[0].count,
      ),
      0,
      "Explicit audit retention did not remove old rows",
    );
    console.log(
      `${id}/${database}: two workers, immutable email snapshot, retry schedule/max5/recovery, abandoned lease/max-attempt recovery, dry-run/idempotent retention and active hashes/audit/pending/notification protection passed`,
    );
  } finally {
    await mode("normal");
    await connection.end();
    compose("up", "-d", "--no-deps", "--scale", "worker=1", "worker");
  }
}
