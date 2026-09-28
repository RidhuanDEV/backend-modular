import bcrypt from "bcrypt";
import { prisma, disconnectPrisma } from "../config/prisma.js";
import { PERMISSION_GROUPS } from "../constants/permissions.constants.js";

const ROLE_NAMES = ["admin", "user"] as const;
const SALT_ROUNDS = 12;

function getPermissionNames(): string[] {
  return Object.values(PERMISSION_GROUPS).flatMap((group) =>
    Object.values(group),
  );
}

async function seedRoles(): Promise<void> {
  for (const name of ROLE_NAMES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function seedPermissions(): Promise<void> {
  for (const name of getPermissionNames()) {
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function seedAdminRolePermissions(): Promise<void> {
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "admin" },
  });
  const permissions = await prisma.permission.findMany({
    select: { id: true },
  });

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }
}

interface BootstrapUserConfig {
  emailEnvKey: string;
  passwordEnvKey: string;
  roleName: (typeof ROLE_NAMES)[number];
}

async function seedBootstrapUser(config: BootstrapUserConfig): Promise<void> {
  const email = process.env[config.emailEnvKey];
  const password = process.env[config.passwordEnvKey];

  if (!email || !password) {
    console.log(
      `Skipping bootstrap ${config.roleName} seed; ${config.emailEnvKey} or ${config.passwordEnvKey} is missing`,
    );
    return;
  }

  const role = await prisma.role.findUniqueOrThrow({
    where: { name: config.roleName },
  });
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        roleId: role.id,
        deletedAt: null,
      },
    });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      roleId: role.id,
    },
  });
}

async function main(): Promise<void> {
  await seedRoles();
  await seedPermissions();
  await seedAdminRolePermissions();
  await seedBootstrapUser({
    emailEnvKey: "ADMIN_EMAIL",
    passwordEnvKey: "ADMIN_PASSWORD",
    roleName: "admin",
  });
  await seedBootstrapUser({
    emailEnvKey: "USER_EMAIL",
    passwordEnvKey: "USER_PASSWORD",
    roleName: "user",
  });
}

try {
  await main();
  console.log("Database seed completed");
} finally {
  await disconnectPrisma();
}
