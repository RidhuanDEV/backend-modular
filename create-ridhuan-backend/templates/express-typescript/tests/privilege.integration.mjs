import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("user and role managers cannot grant privileges they do not hold", { skip: !process.env.DATABASE_URL }, async () => {
  process.env.JWT_SECRET ??= "test_secret_at_least_32_characters_long";
  process.env.CACHE_ENABLED = "false";
  process.env.RATE_LIMIT_STORE = "memory";
  const { app } = await import("../dist/app.js");
  const { prisma } = await import("../dist/config/prisma.js");
  const { signToken } = await import("../dist/core/auth/jwt.service.js");
  const suffix = randomUUID();
  const permissionNames = ["manage_users", "manage_roles", "manage_permissions"];
  const permissions = await Promise.all(permissionNames.map((name) =>
    prisma.permission.upsert({ where: { name }, update: {}, create: { name } })));
  const [manageUsers, manageRoles, managePermissions] = permissions;
  const superRole = await prisma.role.create({ data: { name: `priv_super_${suffix}` } });
  const managerRole = await prisma.role.create({ data: { name: `priv_manager_${suffix}` } });
  const plainRole = await prisma.role.create({ data: { name: `priv_plain_${suffix}` } });
  await prisma.rolePermission.createMany({ data: permissions.map((p) => ({ roleId: superRole.id, permissionId: p.id })) });
  await prisma.rolePermission.createMany({ data: [manageUsers, manageRoles].map((p) => ({ roleId: managerRole.id, permissionId: p.id })) });
  const manager = await prisma.user.create({ data: { email: `manager_${suffix}@example.test`, password: "unused", roleId: managerRole.id } });
  const superUser = await prisma.user.create({ data: { email: `super_${suffix}@example.test`, password: "unused", roleId: superRole.id } });
  const plain = await prisma.user.create({ data: { email: `plain_${suffix}@example.test`, password: "unused", roleId: plainRole.id } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: manager.id, email: manager.email, roleId: manager.roleId });
  const send = (method, path, body) => fetch(base + path, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await send("PATCH", `/api/users/${plain.id}`, { roleId: superRole.id })).status, 403);
    assert.equal((await send("POST", "/api/users", { email: `new_${suffix}@example.test`, password: "secret123", roleId: superRole.id })).status, 403);
    assert.equal((await send("DELETE", `/api/users/${superUser.id}`)).status, 403);
    assert.equal((await send("POST", `/api/roles/${managerRole.id}/permissions`, { permissionIds: [manageUsers.id, manageRoles.id, managePermissions.id] })).status, 403);
    assert.equal((await send("PATCH", `/api/users/${plain.id}`, { roleId: managerRole.id })).status, 200);
    assert.equal((await send("DELETE", `/api/users/${plain.id}`)).status, 204);
    assert.equal((await send("GET", `/api/users/${plain.id}`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await prisma.activityLog.deleteMany({ where: { userId: { in: [manager.id, superUser.id, plain.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, superUser.id, plain.id] } } });
    await prisma.role.deleteMany({ where: { id: { in: [superRole.id, managerRole.id, plainRole.id] } } });
    await prisma.$disconnect();
  }
});
