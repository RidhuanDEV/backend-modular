import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DB_PROVIDER === "mysql" ? "mysql://test:test@127.0.0.1:3306/test" : "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";
process.env.ENDPOINT_POLICIES_JSON = '{"user.get":{"audit":"optional","cache":"off"},"auth.login":{"audit":"required"}}';

test("endpoint policy changes are read from env at deployment startup", async () => {
  const { endpointPolicy } = await import("../dist/core/http/endpoint-registry.js");
  assert.equal(endpointPolicy("user.get").audit, "optional");
  assert.equal(endpointPolicy("user.get").cache, "off");
  assert.equal(endpointPolicy("auth.login").audit, "required");
  assert.equal(endpointPolicy("user.create").audit, "required");
});
