import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { RedisService } from "../platform/redis/redis.service";

let first: INestApplication;
let second: INestApplication;
before(async () => {
  process.env.RATE_LIMIT_STORE = "redis";
  process.env.CACHE_ENABLED = "true";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.REDIS_NAMESPACE = `integration-${randomUUID()}`;
  process.env.TRUST_PROXY_HOPS = "1";
  process.env.RATE_LIMIT_AUTH_MAX = "2";
  const { createApp } = await import("../main");
  first = await createApp();
  second = await createApp();
});
after(async () => { if (first) await first.close(); if (second) await second.close(); });

test("Redis shares auth quota across instances and fails closed", async () => {
  const ip = "198.51.100.241";
  const send = (app: INestApplication) => request(app.getHttpServer()).post("/api/auth/login")
    .set("X-Forwarded-For", ip).send({ email: "invalid", password: "x" });
  assert.equal((await send(first)).status, 400);
  assert.equal((await send(second)).status, 400);
  assert.equal((await send(first)).status, 429);
  const login = await request(second.getHttpServer()).post("/api/auth/login")
    .set("X-Forwarded-For", "198.51.100.243")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const token = (login.body as { data: { token: string } }).data.token;
  const redis = second.get(RedisService);
  assert.equal(await redis.ping(), true);
  redis.getClient()?.disconnect();
  const separateIp = "198.51.100.242";
  const unavailable = await request(second.getHttpServer()).post("/api/auth/login")
    .set("X-Forwarded-For", separateIp).send({ email: "invalid", password: "x" });
  assert.equal(unavailable.status, 503);
  const publicRequest = await request(second.getHttpServer()).get("/docs/specs/auth.json").set("X-Forwarded-For", separateIp);
  assert.equal(publicRequest.status, 200);
  const cachedReadFallback = await request(second.getHttpServer()).get("/api/users")
    .set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", separateIp);
  assert.equal(cachedReadFallback.status, 200);
  assert.equal((await request(second.getHttpServer()).get("/ready")).status, 503);
});
