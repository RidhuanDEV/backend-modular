import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

let app: INestApplication;
before(async () => {
  process.env.REFRESH_TOKEN_TRANSPORT = "cookie";
  process.env.REFRESH_COOKIE_SECURE = "false";
  const { createApp } = await import("../main");
  app = await createApp();
});
after(async () => {
  if (app) await app.close();
});

function cookieOf(header: unknown): string {
  const cookies = Array.isArray(header) ? header.map(String) : [];
  const cookie = cookies.find((value) => value.startsWith("refresh_token="));
  assert.ok(cookie, "refresh cookie missing");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/auth/);
  assert.match(cookie, /SameSite=Lax/i);
  return cookie.split(";")[0]!;
}

test("cookie transport keeps the refresh token out of JSON and requires X-Requested-With", async () => {
  const server = app.getHttpServer();
  const login = await request(server).post("/api/auth/login").send({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.data.token, "string");
  assert.equal(login.body.data.refreshToken, undefined);
  const cookie = cookieOf(login.headers["set-cookie"]);
  // Browsers attach cookies automatically, so a bare cross-site POST must fail.
  assert.equal(
    (await request(server).post("/api/auth/refresh").set("Cookie", cookie))
      .status,
    403,
  );
  assert.equal((await request(server).post("/api/auth/refresh")).status, 400);
  const refreshed = await request(server)
    .post("/api/auth/refresh")
    .set("Cookie", cookie)
    .set("X-Requested-With", "fetch");
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.data.refreshToken, undefined);
  const rotated = cookieOf(refreshed.headers["set-cookie"]);
  assert.notEqual(rotated, cookie);
  const logout = await request(server)
    .post("/api/auth/logout")
    .set("Cookie", rotated)
    .set("X-Requested-With", "fetch");
  assert.equal(logout.status, 204);
  assert.match(
    String(logout.headers["set-cookie"]),
    /Expires=Thu, 01 Jan 1970/,
  );
  assert.equal(
    (
      await request(server)
        .post("/api/auth/refresh")
        .set("Cookie", rotated)
        .set("X-Requested-With", "fetch")
    ).status,
    401,
  );
});
