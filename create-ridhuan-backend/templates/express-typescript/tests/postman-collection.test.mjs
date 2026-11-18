import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";

const { endpointRegistry } =
  await import("../dist/core/http/endpoint-registry.js");
const collection = JSON.parse(
  readFileSync(
    new URL("../postman/api.collection.json", import.meta.url),
    "utf8",
  ),
);
const requests = collection.item.flatMap((folder) =>
  folder.item.map((item) => item.request),
);

test("Postman collection mirrors the endpoint registry", () => {
  const expected = Object.values(endpointRegistry)
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    .sort();
  const actual = requests
    .map(
      (request) =>
        `${request.method} ${request.url.raw.replace("{{baseUrl}}", "").split("?")[0]}`,
    )
    .sort();
  assert.deepEqual(actual, expected);
});

test("protected requests send the bearer token and JSON bodies are valid", () => {
  for (const request of requests) {
    if (request.body?.mode === "raw") JSON.parse(request.body.raw);
    const internal = Object.values(endpointRegistry).some(
      (endpoint) =>
        endpoint.access.kind === "internal" &&
        `${endpoint.method} ${endpoint.path}` ===
          `${request.method} ${request.url.raw.replace("{{baseUrl}}", "").split("?")[0]}`,
    );
    assert.equal(
      request.header.some((header) => header.value === "Bearer {{token}}"),
      internal,
      request.url.raw,
    );
  }
});
