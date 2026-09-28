import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";
process.env.UPLOAD_ENABLED = "true";

test("UTC instants require offset and format in Indonesian and overseas zones", async () => {
  const { parseInstant, formatInZone } = await import("../dist/core/time/time.js");
  assert.equal(parseInstant("2026-01-01T00:00:00Z").toISOString(), "2026-01-01T00:00:00.000Z");
  assert.throws(() => parseInstant("2026-01-01T00:00:00"));
  const instant = new Date("2026-01-01T00:00:00Z");
  assert.match(formatInZone(instant, "Asia/Jakarta"), /07[.:]00/);
  assert.match(formatInZone(instant, "Asia/Makassar"), /08[.:]00/);
  assert.match(formatInZone(instant, "Asia/Jayapura"), /09[.:]00/);
  assert.match(formatInZone(instant, "America/New_York"), /GMT-5/);
  assert.match(formatInZone(new Date("2026-07-01T00:00:00Z"), "America/New_York"), /GMT-4/);
  assert.throws(() => formatInZone(instant, "Invalid/Zone"));
});

test("every registered endpoint appears once in generated OpenAPI", async () => {
  const { endpointRegistry } = await import("../dist/core/http/endpoint-registry.js");
  const { generateOpenApi } = await import("../dist/docs/openapi.js");
  const spec = generateOpenApi();
  const ids = Object.values(spec.paths).flatMap((path) =>
    Object.values(path).map((operation) => operation.operationId));
  assert.equal(ids.length, Object.keys(endpointRegistry).length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("upload.create"));
  assert.ok(spec.paths["/api/users/{id}"].patch.requestBody);
});

test("module OpenAPI route contains only its module", async () => {
  const { app } = await import("../dist/app.js");
  const server = app.listen(0);
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const response = await fetch(base + "/docs/specs/user.json");
    assert.equal(response.status, 200);
    const spec = await response.json();
    const ids = Object.values(spec.paths).flatMap((path) =>
      Object.values(path).map((operation) => operation.operationId));
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => id.startsWith("user.")));
    assert.equal((await fetch(base + "/docs/specs/missing.json")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("audit snapshot redacts secrets recursively and preserves actor identity", async () => {
  const { auditLogRepository } = await import("../dist/core/audit/audit-log.repository.js");
  let written;
  const transaction = { activityLog: { create: async (input) => { written = input.data; } } };
  await auditLogRepository.create({
    action: "CREATE", module: "user", entityId: "entity", userId: "actor",
    before: { password: "hash", nested: [{ apiKey: "secret", safe: "visible" }] },
  }, transaction);
  assert.equal(written.actorIdSnapshot, "actor");
  assert.equal(written.behavior, "CREATE");
  assert.equal(written.before.password, "[REDACTED]");
  assert.equal(written.before.nested[0].apiKey, "[REDACTED]");
  assert.equal(written.before.nested[0].safe, "visible");
});

test("audit modes enforce required, queue optional, and skip none", async () => {
  const { auditLogRepository } = await import("../dist/core/audit/audit-log.repository.js");
  const { auditService } = await import("../dist/core/audit/audit.service.js");
  const { runWithEndpoint, currentEndpoint } = await import("../dist/core/http/endpoint-context.js");
  const original = auditLogRepository.create;
  const writes = [];
  auditLogRepository.create = async (data) => { writes.push(data); };
  try {
    await runWithEndpoint("user.create", async () => {
      await auditService.persist({ action: "CREATE", module: "user", entityId: "a", userId: "u", trx: {} });
      assert.equal(currentEndpoint().auditWritten, true);
    });
    assert.equal(writes.length, 1);
    await runWithEndpoint("auth.login", async () => {
      await auditService.persist({ action: "LOGIN", module: "auth", userId: "u" });
      assert.equal(writes.length, 1);
      assert.equal(currentEndpoint().pendingAudits.length, 1);
      await currentEndpoint().pendingAudits[0]();
    });
    assert.equal(writes.length, 2);
    await runWithEndpoint("user.get", async () => {
      await auditService.persist({ action: "READ", module: "user", entityId: "a", userId: "u" });
    });
    assert.equal(writes.length, 2);
    auditLogRepository.create = async () => { throw new Error("database unavailable"); };
    await assert.rejects(runWithEndpoint("user.create", () => auditService.persist({
      action: "CREATE", module: "user", entityId: "a", userId: "u", trx: {},
    })), /database unavailable/);
  } finally {
    auditLogRepository.create = original;
  }
});
