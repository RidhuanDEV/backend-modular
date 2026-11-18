import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { z } from "zod";
import {
  fieldsQuery,
  projectFields,
  selectedFields,
} from "../dist/core/http/fields.js";
import { validate } from "../dist/core/middleware/validate.middleware.js";

const allowed = ["id", "email", "roleId"];

test("fields accepts allowlisted names in any spacing and order", () => {
  const schema = fieldsQuery(allowed);
  for (const value of [
    undefined,
    "email",
    "id,email",
    " email , roleId ",
    "email,email",
    "email,",
    "",
  ])
    assert.equal(schema.safeParse(value).success, true, `accepted: ${value}`);
});

test("fields rejects names outside the allowlist", () => {
  const schema = fieldsQuery(allowed);
  for (const value of [
    "password",
    "email,password",
    "Email",
    "role",
    "createdAt",
    "id;email",
    "__proto__",
  ])
    assert.equal(schema.safeParse(value).success, false, `rejected: ${value}`);
});

test("selectedFields keeps allowlist order and treats empty as the full object", () => {
  assert.deepEqual(selectedFields("roleId, id", allowed), ["id", "roleId"]);
  assert.equal(selectedFields(undefined, allowed), undefined);
  assert.equal(selectedFields(" , ", allowed), undefined);
});

test("projectFields returns only the selected keys", () => {
  const row = { id: "1", email: "a@b.c", roleId: "r" };
  assert.deepEqual(projectFields(row, ["email"]), { email: "a@b.c" });
  assert.equal(projectFields(row, undefined), row);
});

test("validated query survives Express 5's re-parsing req.query getter", async () => {
  const app = express();
  app.get(
    "/q",
    validate({
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().max(100).default(10),
      }),
    }),
    (req, res) => res.json(req.query),
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/q`)).json(), {
      page: 1,
      limit: 10,
    });
    assert.deepEqual(await (await fetch(`${base}/q?page=3&limit=5`)).json(), {
      page: 3,
      limit: 5,
    });
    assert.equal((await fetch(`${base}/q?limit=500`)).status, 400);
  } finally {
    server.close();
  }
});
