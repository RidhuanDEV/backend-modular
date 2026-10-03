import "../config/load-env";
import {
  createDatabaseAdapter,
  databaseProvider,
} from "../platform/database/database-adapter";
import { PrismaClient } from "../generated/prisma/client";
import bcrypt from "bcrypt";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (
    !url ||
    !email ||
    !password ||
    password.length < 12 ||
    password.includes("replace")
  ) {
    throw new Error(
      "DATABASE_URL, ADMIN_EMAIL and a strong ADMIN_PASSWORD are required for explicit seed",
    );
  }
  const prisma = new PrismaClient({
    adapter: createDatabaseAdapter(url, databaseProvider()),
  });
  try {
    const permissions = [
      "manage_users",
      "manage_roles",
      "manage_permissions",
      "manage_uploads",
      "manage_notifications",
    ] as const;
    const admin = await prisma.role.upsert({
      where: { name: "admin" },
      create: { name: "admin" },
      update: {},
    });
    await prisma.role.upsert({
      where: { name: "user" },
      create: { name: "user" },
      update: {},
    });
    for (const name of permissions) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: admin.id,
            permissionId: permission.id,
          },
        },
        create: { roleId: admin.id, permissionId: permission.id },
        update: {},
      });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing)
      await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 12),
          roleId: admin.id,
        },
      });
    process.stdout.write("Seed completed\n");
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Seed failed"}\n`,
  );
  process.exitCode = 1;
});
