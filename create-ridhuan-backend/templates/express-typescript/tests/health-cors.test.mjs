import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";
process.env.CORS_ORIGINS = "http://localhost:5173,http://example.test";

test("liveness is independent of database and readiness checks required dependencies", async () => {
  const { app } = await import("../dist/app.js");
  const { checkReadiness } = await import("../dist/core/http/health.js");
  assert.equal(await checkReadiness({ database: async () => { throw new Error("down"); } }), false);
  assert.equal(await checkReadiness({ database: async () => 1 }), true);
  assert.equal(await checkReadiness({ database: async () => 1, rateStore: async () => { throw new Error("down"); } }), false);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/live`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CORS allows listed origins, rejects others and permits requests without Origin", async () => {
  const { app } = await import("../dist/app.js");
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const allowed = await fetch(`${base}/live`, { headers: { Origin: "http://example.test" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://example.test");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
    const denied = await fetch(`${base}/live`, { headers: { Origin: "http://other.test" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal((await fetch(`${base}/live`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production rejects missing or malformed CORS origins", () => {
  for (const value of [undefined, "", "https://example.test/path", "*"]) {
    const environment = { ...process.env, NODE_ENV: "production" };
    if (value === undefined) delete environment.CORS_ORIGINS;
    else environment.CORS_ORIGINS = value;
    const result = spawnSync(process.execPath, ["-e", `import('${new URL("../dist/config/env.js", import.meta.url).href}')`], {
      env: environment,
      cwd: new URL(".", import.meta.url),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /CORS_ORIGINS/);
  }
});
