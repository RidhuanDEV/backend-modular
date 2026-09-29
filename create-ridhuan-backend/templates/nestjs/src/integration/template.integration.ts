import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import request from "supertest";
import { firstValueFrom } from "rxjs";
import type { INestApplication } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { endpointRegistry } from "../common/endpoint/endpoint.registry";
import { PrismaService } from "../platform/database/prisma.service";
import { NotificationsController } from "../modules/notifications/notifications.controller";
import type { ApiRequest } from "../common/http/request-context";

let app: INestApplication;
let prisma: PrismaService;
function field(value: unknown, key: string): unknown {
  assert.ok(value && typeof value === "object" && key in value);
  return (value as Record<string, unknown>)[key];
}
function textField(value: unknown, key: string): string {
  const result = field(value, key);
  assert.equal(typeof result, "string");
  return result as string;
}
before(async () => {
  const { createApp } = await import("../main");
  app = await createApp();
  prisma = app.get(PrismaService);
});
after(async () => { if (app) await app.close(); });

test("auth refresh rotation, replay revocation and public DTO", async () => {
  const email = `integration-${randomUUID()}@example.com`;
  const registered = await request(app.getHttpServer()).post("/api/auth/register")
    .send({ email, password: "strong-password-123" });
  assert.equal(registered.status, 201);
  assert.deepEqual(Object.keys(field(registered.body, "data") as Record<string, unknown>).sort(),
    ["createdAt", "email", "id", "roleId", "updatedAt"]);
  const login = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email, password: "strong-password-123" });
  assert.equal(login.status, 200);
  const data = field(login.body, "data");
  assert.deepEqual(Object.keys(data as Record<string, unknown>).sort(), ["refreshToken", "token"]);
  const token = textField(data, "token");
  const refreshToken = textField(data, "refreshToken");
  const me = await request(app.getHttpServer()).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(me.status, 200);
  const user = field(me.body, "data");
  assert.deepEqual(Object.keys(user as Record<string, unknown>).sort(),
    ["createdAt", "email", "id", "roleId", "updatedAt"]);
  const rotated = await request(app.getHttpServer()).post("/api/auth/refresh").send({ refreshToken });
  assert.equal(rotated.status, 200);
  const replacement = textField(field(rotated.body, "data"), "refreshToken");
  assert.equal((await request(app.getHttpServer()).post("/api/auth/refresh").send({ refreshToken })).status, 401);
  assert.equal((await request(app.getHttpServer()).post("/api/auth/refresh").send({ refreshToken: replacement })).status, 401);
  const logout = await request(app.getHttpServer()).post("/api/auth/logout")
    .send({ refreshToken: "unknown-refresh-token-with-enough-length" });
  assert.equal(logout.status, 204);
  assert.equal(logout.text, "");
});

test("admin CRUD writes public data and activity logs", async () => {
  const login = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const token = textField(field(login.body, "data"), "token");
  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: "user" } });
  const email = `created-${randomUUID()}@example.com`;
  const created = await request(app.getHttpServer()).post("/api/users").set("Authorization", `Bearer ${token}`)
    .send({ email, password: "new-password-123", roleId: userRole.id });
  assert.equal(created.status, 201);
  const id = textField(field(created.body, "data"), "id");
  assert.equal((field(created.body, "data") as Record<string, unknown>).password, undefined);
  const updated = await request(app.getHttpServer()).patch(`/api/users/${id}`).set("Authorization", `Bearer ${token}`)
    .send({ email: `updated-${randomUUID()}@example.com` });
  assert.equal(updated.status, 200);
  const removed = await request(app.getHttpServer()).delete(`/api/users/${id}`).set("Authorization", `Bearer ${token}`);
  assert.equal(removed.status, 204);
  assert.equal((await request(app.getHttpServer()).get(`/api/users/${id}`).set("Authorization", `Bearer ${token}`)).status, 404);
  const logs = await prisma.activityLog.count({ where: { module: "user", entityId: id } });
  assert.equal(logs, 3);
});

test("local upload accepts signature and returns only metadata", async () => {
  const login = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const token = textField(field(login.body, "data"), "token");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
  const uploaded = await request(app.getHttpServer()).post("/api/upload").set("Authorization", `Bearer ${token}`)
    .attach("file", png, { filename: "dot.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  const id = textField(field(uploaded.body, "data"), "id");
  const metadata = await request(app.getHttpServer()).get(`/api/upload/${id}`).set("Authorization", `Bearer ${token}`);
  assert.equal(metadata.status, 200);
  assert.equal((field(metadata.body, "data") as Record<string, unknown>).objectKey, undefined);
  const invalid = await request(app.getHttpServer()).post("/api/upload").set("Authorization", `Bearer ${token}`)
    .attach("file", Buffer.from("fake"), { filename: "bad.png", contentType: "image/png" });
  assert.equal(invalid.status, 400);
  const oversized = await request(app.getHttpServer()).post("/api/upload").set("Authorization", `Bearer ${token}`)
    .attach("file", Buffer.alloc(10_485_761), { filename: "large.png", contentType: "image/png" });
  assert.equal(oversized.status, 413);
});

test("role and permission changes preserve public DTO and audit records", async () => {
  const login = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const token = textField(field(login.body, "data"), "token");
  const authorization = `Bearer ${token}`;
  const permissionName = `perm_${randomUUID().replaceAll("-", "")}`;
  const permission = await request(app.getHttpServer()).post("/api/permissions")
    .set("Authorization", authorization).send({ name: permissionName });
  assert.equal(permission.status, 201);
  const permissionId = textField(field(permission.body, "data"), "id");
  const roleName = `role_${randomUUID().replaceAll("-", "")}`;
  const role = await request(app.getHttpServer()).post("/api/roles")
    .set("Authorization", authorization).send({ name: roleName });
  assert.equal(role.status, 201);
  const roleId = textField(field(role.body, "data"), "id");
  const assigned = await request(app.getHttpServer()).post(`/api/roles/${roleId}/permissions`)
    .set("Authorization", authorization).send({ permissionIds: [permissionId] });
  assert.equal(assigned.status, 200);
  assert.deepEqual(field(field(assigned.body, "data"), "permissions"), [{ id: permissionId, name: permissionName }]);
  assert.equal(await prisma.activityLog.count({ where: { module: "roles", entityId: roleId } }), 2);
  assert.equal((await request(app.getHttpServer()).delete(`/api/roles/${roleId}`)
    .set("Authorization", authorization)).status, 204);
  assert.equal((await request(app.getHttpServer()).delete(`/api/permissions/${permissionId}`)
    .set("Authorization", authorization)).status, 204);
});

test("a required audit failure rolls back the business mutation", async () => {
  const login = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const token = textField(field(login.body, "data"), "token");
  const name = `rollback_${randomUUID().replaceAll("-", "")}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_permission_audit() RETURNS trigger AS $$
    BEGIN IF NEW."endpointId" = 'permission.create' THEN RAISE EXCEPTION 'audit test failure'; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_permission_audit_insert BEFORE INSERT ON activity_logs
    FOR EACH ROW EXECUTE FUNCTION reject_permission_audit()`);
  try {
    const response = await request(app.getHttpServer()).post("/api/permissions")
      .set("Authorization", `Bearer ${token}`).send({ name });
    assert.equal(response.status, 500);
    assert.equal(await prisma.permission.count({ where: { name } }), 0);
    const optionalName = `optional_${randomUUID().replaceAll("-", "")}`;
    const audit = app.get(AuditService);
    await audit.transact(async (tx) => {
      const created = await tx.permission.create({ data: { name: optionalName } });
      return [created, { endpointId: "permission.create", policy: { ...endpointRegistry["permission.create"], audit: "optional" },
        behavior: "created", module: "permissions", entityId: created.id }] as const;
    });
    assert.equal(await prisma.permission.count({ where: { name: optionalName } }), 1);
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER reject_permission_audit_insert ON activity_logs");
    await prisma.$executeRawUnsafe("DROP FUNCTION reject_permission_audit()");
  }
});

test("notifications persist, stream to their recipient, mark read and report disabled SMTP", async () => {
  const email = `notify-${randomUUID()}@example.com`;
  const registered = await request(app.getHttpServer()).post("/api/auth/register")
    .send({ email, password: "strong-password-123" });
  assert.equal(registered.status, 201);
  const recipientId = textField(field(registered.body, "data"), "id");
  const recipientLogin = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email, password: "strong-password-123" });
  const recipientToken = textField(field(recipientLogin.body, "data"), "token");
  const adminLogin = await request(app.getHttpServer()).post("/api/auth/login")
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const adminToken = textField(field(adminLogin.body, "data"), "token");
  const denied = await request(app.getHttpServer()).post("/api/notifications")
    .set("Authorization", `Bearer ${recipientToken}`).send({ recipientId, title: "Hello", body: "Your update" });
  assert.equal(denied.status, 403);
  const created = await request(app.getHttpServer()).post("/api/notifications")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ recipientId, title: "Hello", body: "Your update", sendEmail: true });
  assert.equal(created.status, 201);
  const value = field(created.body, "data");
  const id = textField(value, "id");
  assert.equal(field(value, "emailStatus"), "FAILED");
  const list = await request(app.getHttpServer()).get("/api/notifications")
    .set("Authorization", `Bearer ${recipientToken}`);
  assert.equal(list.status, 200);
  assert.ok((field(list.body, "data") as Array<{ id: string }>).some((item) => item.id === id));
  const streamEvent = await firstValueFrom(app.get(NotificationsController).stream(
    { id: recipientId, email, roleId: "" }, { accessExpiresAt: Date.now() + 10000 } as ApiRequest));
  assert.equal(streamEvent.id, id);
  const wrongRecipient = await request(app.getHttpServer()).patch(`/api/notifications/${id}/read`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(wrongRecipient.status, 404);
  const read = await request(app.getHttpServer()).patch(`/api/notifications/${id}/read`)
    .set("Authorization", `Bearer ${recipientToken}`);
  assert.equal(read.status, 200);
  assert.equal(typeof field(field(read.body, "data"), "readAt"), "string");
  assert.equal(await prisma.activityLog.count({ where: { module: "notifications", entityId: id } }), 2);
});

test("user and role managers cannot grant privileges they do not hold", async () => {
  const bcrypt = (await import("bcrypt")).default;
  const suffix = randomUUID();
  const permissions = await prisma.permission.findMany({ where: { name: { in: ["manage_users", "manage_roles", "manage_permissions"] } } });
  const byName = new Map(permissions.map((item) => [item.name, item.id]));
  const managerRole = await prisma.role.create({ data: { name: `priv_manager_${suffix}` } });
  const plainRole = await prisma.role.create({ data: { name: `priv_plain_${suffix}` } });
  await prisma.rolePermission.createMany({ data: ["manage_users", "manage_roles"].map((name) => ({ roleId: managerRole.id, permissionId: byName.get(name)! })) });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "admin" } });
  const password = "manager-password-123";
  const manager = await prisma.user.create({ data: { email: `manager-${suffix}@example.com`, password: await bcrypt.hash(password, 4), roleId: managerRole.id } });
  const plain = await prisma.user.create({ data: { email: `plain-${suffix}@example.com`, password: "unused", roleId: plainRole.id } });
  const admin = await prisma.user.findFirstOrThrow({ where: { roleId: adminRole.id, deletedAt: null } });
  const login = await request(app.getHttpServer()).post("/api/auth/login").send({ email: manager.email, password });
  assert.equal(login.status, 200);
  const token = textField(field(login.body, "data"), "token");
  const call = (method: "patch" | "post" | "delete", path: string, body?: object) =>
    request(app.getHttpServer())[method](path).set("Authorization", `Bearer ${token}`).send(body);
  assert.equal((await call("patch", `/api/users/${plain.id}`, { roleId: adminRole.id })).status, 403);
  assert.equal((await call("post", "/api/users", { email: `new-${suffix}@example.com`, password: "secret-123", roleId: adminRole.id })).status, 403);
  assert.equal((await call("delete", `/api/users/${admin.id}`)).status, 403);
  assert.equal((await call("post", `/api/roles/${managerRole.id}/permissions`, { permissionIds: [...byName.values()] })).status, 403);
  assert.equal((await call("patch", `/api/users/${plain.id}`, { roleId: managerRole.id })).status, 200);
  assert.equal((await call("delete", `/api/users/${plain.id}`)).status, 204);
});
