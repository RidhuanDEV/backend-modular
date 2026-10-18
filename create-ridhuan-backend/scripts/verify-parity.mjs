// Security rules every generated backend must share, checked over real HTTP.
// Per-template differences are explicit here so drift between stacks fails CI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyParity({ id, baseURL, credentials }) {
  const call = async (path, { method = "GET", body, raw, token } = {}) => {
    const response = await fetch(baseURL + path, {
      method,
      headers: {
        connection: "close",
        ...(body !== undefined || raw !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(raw !== undefined
        ? { body: raw }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* Non-JSON bodies only matter through their status. */
    }
    return { status: response.status, json };
  };
  const expect = async (label, pending, allowed) => {
    const { status, json } = await pending;
    assert(
      allowed.includes(status),
      `${id} parity: ${label} returned ${status}, expected ${allowed.join(" or ")}`,
    );
    return json;
  };
  const login = await expect(
    "admin login",
    call("/api/auth/login", { method: "POST", body: credentials }),
    [200],
  );
  const token = login.data[id === "dotnet" ? "accessToken" : "token"];
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  // The seeded root role grants permissions created after seeding (anti-escalation exemption).
  const permission = await expect(
    "admin creates permission",
    call("/api/permissions", {
      method: "POST",
      token,
      body: { name: `parity_${suffix}` },
    }),
    [201],
  );
  const role = await expect(
    "admin creates role",
    call("/api/roles", {
      method: "POST",
      token,
      body: { name: `parity_${suffix}` },
    }),
    [201],
  );
  await expect(
    "admin grants a post-seed permission",
    call(`/api/roles/${role.data.id}/permissions`, {
      method: "POST",
      token,
      body: { permissionIds: [permission.data.id] },
    }),
    [200],
  );

  // Emails are normalized: case variants are the same account.
  const email = `Parity.${suffix}@Example.Test`;
  const password = "Parity-fixture-password-1";
  await expect(
    "register",
    call("/api/auth/register", { method: "POST", body: { email, password } }),
    [201],
  );
  await expect(
    "case-variant duplicate register",
    call("/api/auth/register", {
      method: "POST",
      body: { email: email.toLowerCase(), password },
    }),
    [409],
  );
  await expect(
    "login with a different email case",
    call("/api/auth/login", {
      method: "POST",
      body: { email: email.toUpperCase(), password },
    }),
    [200],
  );

  // 74 UTF-8 bytes exceeds bcrypt's limit: an input error, never a 500 or silent truncation.
  // FastAPI (Argon2) and .NET (ASP.NET Identity PBKDF2) have no such limit and accept it.
  await expect(
    "password over 72 bytes",
    call("/api/auth/register", {
      method: "POST",
      body: { email: `long.${suffix}@example.test`, password: "é".repeat(37) },
    }),
    id === "fastapi" || id === "dotnet"
      ? [201]
      : id === "laravel"
        ? [422]
        : [400],
  );

  // Malformed JSON is a client error. Laravel parses it as an empty body, so validation answers 422.
  await expect(
    "malformed JSON",
    call("/api/auth/login", { method: "POST", raw: "{" }),
    id === "laravel" ? [422] : [400],
  );
}
