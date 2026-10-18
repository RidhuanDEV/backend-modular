import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test(
  "system RBAC primitives, lockout guard, session revocation and file ownership",
  { skip: !process.env.DATABASE_URL },
  async () => {
    process.env.JWT_SECRET ??= "test_secret_at_least_32_characters_long";
    process.env.CACHE_ENABLED = "false";
    process.env.RATE_LIMIT_STORE = "memory";
    const { app } = await import("../dist/app.js");
    const { prisma } = await import("../dist/config/prisma.js");
    const { signToken } = await import("../dist/core/auth/jwt.service.js");
    const { guardSystemPermissionHolders } =
      await import("../dist/core/auth/privilege.js");
    const suffix = randomUUID();
    const names = [
      "manage_users",
      "manage_roles",
      "manage_permissions",
      "manage_uploads",
      "manage_notifications",
    ];
    await prisma.permission.createMany({
      data: names.map((name) => ({ name })),
      skipDuplicates: true,
    });
    const system = await prisma.permission.findMany({
      where: { name: { in: names } },
    });
    const adminRole = await prisma.role.upsert({
      where: { name: "admin" },
      update: {},
      create: { name: "admin" },
    });
    const userRole = await prisma.role.upsert({
      where: { name: "user" },
      update: {},
      create: { name: "user" },
    });
    await prisma.rolePermission.createMany({
      data: system.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    const root = await prisma.user.create({
      data: {
        email: `root_${suffix}@example.test`,
        password: "unused",
        roleId: adminRole.id,
      },
    });
    // Holds manage_uploads, so only the ownership rule can deny it another user's file.
    const uploaderRole = await prisma.role.create({
      data: { name: `uploader_${suffix}` },
    });
    await prisma.rolePermission.create({
      data: {
        roleId: uploaderRole.id,
        permissionId: system.find((p) => p.name === "manage_uploads").id,
      },
    });
    const member = await prisma.user.create({
      data: {
        email: `member_${suffix}@example.test`,
        password: "unused",
        roleId: uploaderRole.id,
      },
    });
    const file = await prisma.storedFile.create({
      data: {
        storage: "local",
        objectKey: randomUUID(),
        originalName: "a.pdf",
        mimeType: "application/pdf",
        size: 1,
        uploaderId: root.id,
      },
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (u) =>
      signToken({ id: u.id, email: u.email, roleId: u.roleId });
    const send = (token, method, path, body) =>
      fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const rootToken = tokenFor(root);
    const manageUsers = system.find((p) => p.name === "manage_users");
    let custom = { id: randomUUID() };
    try {
      // RBAC only: a new permission is granted to every role managing permissions.
      const created = await send(rootToken, "POST", "/api/permissions", {
        name: `custom_${suffix}`,
      });
      assert.equal(created.status, 201);
      custom = (await created.json()).data;
      assert.ok(
        await prisma.rolePermission.findFirst({
          where: { roleId: adminRole.id, permissionId: custom.id },
        }),
      );
      // F-01: system permissions are immutable and their names are reserved.
      assert.equal(
        (
          await send(rootToken, "PATCH", `/api/permissions/${manageUsers.id}`, {
            name: `x_${suffix}`,
          })
        ).status,
        403,
      );
      assert.equal(
        (await send(rootToken, "DELETE", `/api/permissions/${manageUsers.id}`))
          .status,
        403,
      );
      assert.equal(
        (
          await send(rootToken, "PATCH", `/api/permissions/${custom.id}`, {
            name: "manage_users",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await send(rootToken, "PATCH", `/api/permissions/${custom.id}`, {
            name: `renamed_${suffix}`,
          })
        ).status,
        200,
      );
      // F-02: system roles keep their names and cannot be deleted; root keeps system permissions.
      assert.equal(
        (
          await send(rootToken, "PATCH", `/api/roles/${userRole.id}`, {
            name: `x_${suffix}`,
          })
        ).status,
        403,
      );
      assert.equal(
        (await send(rootToken, "DELETE", `/api/roles/${userRole.id}`)).status,
        403,
      );
      assert.equal(
        (await send(rootToken, "POST", "/api/roles", { name: "admin" })).status,
        403,
      );
      // F-07: files are readable by their uploader and root users only.
      assert.equal(
        (await send(tokenFor(member), "GET", `/api/upload/${file.id}`)).status,
        404,
      );
      assert.equal(
        (await send(rootToken, "GET", `/api/upload/${file.id}`)).status,
        200,
      );
      // F-10: a role change revokes the user's refresh sessions.
      const family = await prisma.refreshFamily.create({
        data: {
          id: randomUUID(),
          userId: member.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const managerRole = await prisma.role.create({
        data: { name: `mgr_${suffix}` },
      });
      assert.equal(
        (
          await send(rootToken, "PATCH", `/api/users/${member.id}`, {
            roleId: managerRole.id,
          })
        ).status,
        200,
      );
      assert.notEqual(
        (await prisma.refreshFamily.findUnique({ where: { id: family.id } }))
          .revokedAt,
        null,
      );
      // F-09: no change may leave a system permission without an active holder,
      // whether by demoting the last holder or stripping the role's permissions.
      for (const change of [
        (tx) =>
          tx.user.update({
            where: { id: root.id },
            data: { roleId: managerRole.id },
          }),
        (tx) =>
          tx.rolePermission.deleteMany({
            where: { roleId: adminRole.id, permissionId: { not: custom.id } },
          }),
      ]) {
        await assert.rejects(
          prisma.$transaction(async (tx) => {
            await tx.user.updateMany({
              where: { id: { not: root.id }, deletedAt: null },
              data: { deletedAt: new Date() },
            });
            const holders = await guardSystemPermissionHolders(tx);
            await change(tx);
            await holders();
            throw new Error("expected lockout guard");
          }),
          (error) => error.statusCode === 403,
        );
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await prisma.storedFile.deleteMany({ where: { id: file.id } });
      await prisma.activityLog.deleteMany({
        where: { userId: { in: [root.id, member.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [root.id, member.id] } },
      });
      await prisma.role.deleteMany({
        where: { name: { in: [`mgr_${suffix}`, `uploader_${suffix}`] } },
      });
      await prisma.permission.deleteMany({ where: { id: custom.id } });
      await prisma.$disconnect();
    }
  },
);
