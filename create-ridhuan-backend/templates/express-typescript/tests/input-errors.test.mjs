import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";

function captureResponse() {
  const response = { statusCode: 200, body: undefined };
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (body) => { response.body = body; return response; };
  return response;
}

test("emails are normalized and bcrypt-truncated passwords are rejected", async () => {
  const { registerSchema, loginSchema } = await import("../dist/modules/auth/auth.schema.js");
  assert.equal(registerSchema.parse({ email: "  Admin@Example.COM ", password: "secret1" }).email, "admin@example.com");
  assert.equal(loginSchema.parse({ email: "USER@example.com", password: "x" }).email, "user@example.com");
  assert.equal(registerSchema.safeParse({ email: "a@example.com", password: "é".repeat(37) }).success, false);
  assert.equal(registerSchema.safeParse({ email: "a@example.com", password: "a".repeat(72) }).success, true);
});

test("user list pagination is bounded", async () => {
  const { searchUserSchema } = await import("../dist/modules/user/user.schema.js");
  assert.equal(searchUserSchema.safeParse({ limit: "101" }).success, false);
  assert.equal(searchUserSchema.safeParse({ page: "0" }).success, false);
  assert.deepEqual(searchUserSchema.parse({}), { page: 1, limit: 10 });
});

test("expected client failures are not reported as 500", async () => {
  const { Prisma } = await import("@prisma/client");
  const { errorMiddleware } = await import("../dist/core/middleware/error.middleware.js");
  const request = { requestId: "r", path: "/api/users", method: "POST" };

  const duplicate = captureResponse();
  errorMiddleware(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }), request, duplicate, () => {});
  assert.equal(duplicate.statusCode, 409);

  const malformed = captureResponse();
  const parseError = Object.assign(new SyntaxError("Unexpected token"), { status: 400, type: "entity.parse.failed" });
  errorMiddleware(parseError, request, malformed, () => {});
  assert.equal(malformed.statusCode, 400);

  const unexpected = captureResponse();
  errorMiddleware(new Error("boom"), request, unexpected, () => {});
  assert.equal(unexpected.statusCode, 500);
});
