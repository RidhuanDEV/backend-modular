import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DB_PROVIDER === "mysql" ? "mysql://test:test@127.0.0.1:3306/test" : "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";
process.env.RATE_LIMIT_PUBLIC_MAX = "2";
process.env.UPLOAD_ENABLED = "false";

test("public rate limit uses env value without Redis", async () => {
  const { app } = await import("../dist/app.js");
  const server = app.listen(0);
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await fetch(base + "/docs/openapi.json")).status);
    assert.deepEqual(codes, [200, 200, 429]);
    assert.equal((await fetch(base + "/live")).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
