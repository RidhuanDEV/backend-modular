import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";
process.env.UPLOAD_ENABLED = "true";

const { generateOpenApi } = await import("../dist/docs/openapi.js");
const spec = generateOpenApi();
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    name: `${method.toUpperCase()} ${path}`,
    operation,
  })),
);

test("every operation documents its error envelope, rate limit and 500", () => {
  assert.ok(spec.components.schemas.ErrorResponse);
  for (const { name, operation } of operations) {
    for (const code of ["429", "500"])
      assert.ok(operation.responses[code], `${name} lacks ${code}`);
    for (const [code, response] of Object.entries(operation.responses))
      if (Number(code) >= 400)
        assert.equal(
          response.content["application/json"].schema.$ref,
          "#/components/schemas/ErrorResponse",
          `${name} ${code}`,
        );
  }
});

test("errors follow access and validation rules", () => {
  const users = spec.paths["/api/users"].get.responses;
  for (const code of ["400", "401", "403"]) assert.ok(users[code], code);
  assert.ok(spec.paths["/api/users/{id}"].get.responses["404"]);
  assert.ok(spec.paths["/ready"].get.responses["503"]);
  assert.equal(spec.paths["/live"].get.responses["401"], undefined);
  assert.equal(spec.paths["/api/auth/login"].post.responses["403"], undefined);
});

test("query parameters with server defaults are optional", () => {
  for (const { name, operation } of operations)
    for (const parameter of operation.parameters ?? [])
      if (parameter.in === "query" && parameter.schema.default !== undefined)
        assert.equal(parameter.required, false, `${name} ${parameter.name}`);
  const fields = spec.paths["/api/users"].get.parameters.find(
    (parameter) => parameter.name === "fields",
  );
  assert.match(fields.description, /id, email, roleId/);
});

test("refresh token cookie transport is documented", () => {
  for (const path of [
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
  ]) {
    const operation = spec.paths[path].post;
    assert.match(operation.description, /REFRESH_TOKEN_TRANSPORT/, path);
    const success = Object.entries(operation.responses).find(
      ([code]) => Number(code) < 300,
    )[1];
    assert.ok(success.headers["Set-Cookie"], path);
  }
  for (const path of ["/api/auth/refresh", "/api/auth/logout"]) {
    const operation = spec.paths[path].post;
    const header = operation.parameters.find(
      (parameter) => parameter.name === "X-Requested-With",
    );
    assert.equal(header.in, "header");
    assert.equal(header.required, false);
    for (const code of ["400", "403"])
      assert.ok(operation.responses[code], `${path} ${code}`);
  }
  assert.equal(
    spec.paths["/api/auth/login"].post.parameters.some(
      (parameter) => parameter.name === "X-Requested-With",
    ),
    false,
  );
});
