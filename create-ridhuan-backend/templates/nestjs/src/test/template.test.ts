import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { validateEnvironment } from "../config/env.validation";
import { endpointRegistry } from "../common/endpoint/endpoint.registry";
import { TimeService } from "../platform/time/time.service";

let app: INestApplication;
before(async () => {
  process.env.DATABASE_URL = "postgresql://backend:backend@127.0.0.1:65432/backend?schema=public";
  process.env.JWT_SECRET = "unit_test_secret_0123456789_abcdefghijklmnop";
  process.env.CORS_ORIGINS = "http://localhost:5173";
  process.env.RATE_LIMIT_STORE = "memory";
  process.env.CACHE_ENABLED = "false";
  const { createApp } = await import("../main");
  app = await createApp();
});
after(async () => { if (app) await app.close(); });

test("production requires explicit CORS origins", () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: "production", DATABASE_URL: "postgresql://localhost/example",
    JWT_SECRET: "local_secret_0123456789_abcdefghijklmnop" }), /CORS_ORIGINS/);
});

test("Redis namespace is explicit and safe for shared servers", () => {
  assert.throws(() => validateEnvironment({ DATABASE_URL: "postgresql://localhost/example",
    JWT_SECRET: "local_secret_0123456789_abcdefghijklmnop", REDIS_NAMESPACE: "other project:" }), /REDIS_NAMESPACE/);
});

test("UTC and IANA time zones represent the same instant", () => {
  const time = new TimeService();
  const instant = time.parseInstant("2026-09-29T00:00:00Z");
  assert.equal(time.isoUtc(instant), "2026-09-29T00:00:00.000Z");
  assert.match(time.formatInZone(instant, "Asia/Jakarta"), /07:00:00/);
  assert.match(time.formatInZone(instant, "Asia/Makassar"), /08:00:00/);
  assert.match(time.formatInZone(instant, "Asia/Jayapura"), /09:00:00/);
  assert.match(time.formatInZone(new Date("2026-01-15T12:00:00Z"), "America/New_York"), /07:00:00/);
  assert.match(time.formatInZone(new Date("2026-07-15T12:00:00Z"), "America/New_York"), /08:00:00/);
  assert.throws(() => time.parseInstant("2026-09-29T00:00:00"));
  assert.throws(() => time.formatInZone(instant, "Mars/Olympus"));
});

test("liveness stays up and readiness fails when database is unavailable", async () => {
  const live = await request(app.getHttpServer()).get("/live");
  const ready = await request(app.getHttpServer()).get("/ready");
  assert.equal(live.status, 200);
  assert.equal(ready.status, 503);
});

test("OpenAPI operations match all endpoint registry IDs", async () => {
  const response = await request(app.getHttpServer()).get("/docs/openapi.json");
  assert.equal(response.status, 200);
  const document: unknown = response.body;
  assert.ok(document && typeof document === "object" && "paths" in document);
  const operations = Object.values(document.paths as Record<string, Record<string, { operationId?: string }>>)
    .flatMap((path) => Object.values(path)).map((entry) => entry.operationId).filter(Boolean);
  assert.equal(operations.length, Object.keys(endpointRegistry).length);
  assert.equal(new Set(operations).size, operations.length);
});

test("CORS only returns header for allowed origins", async () => {
  const allowed = await request(app.getHttpServer()).get("/live").set("Origin", "http://localhost:5173");
  const denied = await request(app.getHttpServer()).get("/live").set("Origin", "https://unlisted.example");
  const noOrigin = await request(app.getHttpServer()).get("/live");
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
  assert.equal(noOrigin.status, 200);
});

test("auth boundary rejects unknown request fields and missing bearer token", async () => {
  const bad = await request(app.getHttpServer()).post("/api/auth/login").send({ email: "bad", password: "x", extra: true });
  const me = await request(app.getHttpServer()).get("/api/auth/me");
  assert.equal(bad.status, 400);
  assert.equal(me.status, 401);
});

test("passwords beyond bcrypt's 72-byte limit are rejected before hashing", async () => {
  const response = await request(app.getHttpServer()).post("/api/auth/register")
    .send({ email: "long@example.com", password: "é".repeat(37) });
  assert.equal(response.status, 400);
});

test("expected Prisma and body-parser failures are not reported as 500", async () => {
  const { HttpExceptionFilter } = await import("../common/http/http-exception.filter");
  const { Prisma } = await import("../generated/prisma/client");
  const captured: { status?: number } = {};
  const response = { status(code: number) { captured.status = code; return this; }, json() { return this; } };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as never;
  const filter = new HttpExceptionFilter();
  filter.catch(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }), host);
  assert.equal(captured.status, 409);
  filter.catch(Object.assign(new SyntaxError("Unexpected token"), { status: 400, type: "entity.parse.failed" }), host);
  assert.equal(captured.status, 400);
});
