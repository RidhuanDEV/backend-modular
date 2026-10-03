import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
function startup(provider, userLength, databaseLength, policy = "{}") {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const {endpointRegistry,endpointPolicy}=await import("./dist/core/http/endpoint-registry.js"); for(const id of Object.keys(endpointRegistry))endpointPolicy(id);',
    ],
    {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DB_PROVIDER: provider,
        DATABASE_URL: `${provider}://${"u".repeat(userLength)}:fixture@localhost:5432/${"d".repeat(databaseLength)}`,
        JWT_SECRET: "identifier_fixture_secret_0123456789abcdef",
        SMTP_ENABLED: "false",
        CACHE_ENABLED: "false",
        RATE_LIMIT_STORE: "memory",
        ENDPOINT_POLICIES_JSON: policy,
      },
    },
  );
}
test("provider username and database limits are independent", () => {
  for (const provider of ["mysql", "postgresql"]) {
    const users = provider === "mysql" ? 32 : 63,
      databases = provider === "mysql" ? 64 : 63;
    assert.equal(startup(provider, users, databases).status, 0);
    assert.notEqual(startup(provider, users + 1, databases).status, 0);
    assert.notEqual(startup(provider, users, databases + 1).status, 0);
  }
});
test("startup rejects unsupported audit capabilities and required GET", () => {
  for (const policy of [
    '{"user.get":{"audit":"required"}}',
    '{"unknown.endpoint":{"audit":"optional"}}',
  ]) {
    assert.notEqual(startup("postgresql", 10, 10, policy).status, 0);
  }
  assert.equal(
    startup(
      "postgresql",
      10,
      10,
      '{"auth.refresh":{"audit":"required"},"auth.logout":{"audit":"required"}}',
    ).status,
    0,
  );
});
