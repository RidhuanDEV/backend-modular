import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test(
  "cookie transport keeps the refresh token out of JSON and requires X-Requested-With",
  { skip: !process.env.DATABASE_URL },
  async () => {
    process.env.JWT_SECRET ??= "test_secret_at_least_32_characters_long";
    process.env.CACHE_ENABLED = "false";
    process.env.RATE_LIMIT_STORE = "memory";
    process.env.REFRESH_TOKEN_TRANSPORT = "cookie";
    process.env.REFRESH_COOKIE_SECURE = "false";
    const { app } = await import("../dist/app.js");
    const { prisma } = await import("../dist/config/prisma.js");
    const bcrypt = (await import("bcrypt")).default;
    const role = await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user" },
    });
    const email = `cookie_${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash("cookie-password", 4),
        roleId: role.id,
      },
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, headers = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const cookieOf = (response) => {
      const header = response.headers.get("set-cookie") ?? "";
      assert.match(header, /refresh_token=/);
      assert.match(header, /HttpOnly/i);
      assert.match(header, /Path=\/api\/auth/);
      assert.match(header, /SameSite=Lax/i);
      return header.split(";")[0];
    };
    try {
      const login = await post("/api/auth/login", {
        email,
        password: "cookie-password",
      });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      assert.equal(typeof loginBody.data.token, "string");
      assert.equal(loginBody.data.refreshToken, undefined);
      const cookie = cookieOf(login);
      // Browsers attach cookies automatically, so a bare cross-site POST must fail.
      assert.equal(
        (await post("/api/auth/refresh", {}, { Cookie: cookie })).status,
        403,
      );
      assert.equal((await post("/api/auth/refresh", {})).status, 400);
      const refreshed = await post(
        "/api/auth/refresh",
        {},
        { Cookie: cookie, "X-Requested-With": "fetch" },
      );
      assert.equal(refreshed.status, 200);
      assert.equal((await refreshed.json()).data.refreshToken, undefined);
      const rotated = cookieOf(refreshed);
      assert.notEqual(rotated, cookie);
      const logout = await post(
        "/api/auth/logout",
        {},
        { Cookie: rotated, "X-Requested-With": "fetch" },
      );
      assert.equal(logout.status, 204);
      assert.match(
        logout.headers.get("set-cookie") ?? "",
        /Expires=Thu, 01 Jan 1970/,
      );
      assert.equal(
        (
          await post(
            "/api/auth/refresh",
            {},
            { Cookie: rotated, "X-Requested-With": "fetch" },
          )
        ).status,
        401,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  },
);
