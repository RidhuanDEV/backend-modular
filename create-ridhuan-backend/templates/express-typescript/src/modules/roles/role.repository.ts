import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { CreateRoleDto, UpdateRoleDto } from "./role.schema.js";

type TransactionClient = Prisma.TransactionClient;

/** Role with eager-loaded permissions */
export type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: {
    permissions: {
      include: { permission: true };
    };
  };
}>;

export class RoleRepository {
  async findAll(): Promise<RoleWithPermissions[]> {
    return prisma.role.findMany({
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }

  async findById(id: string, trx?: TransactionClient): Promise<RoleWithPermissions | null> {
    const client = trx ?? prisma;
    return client.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }

  async findByName(name: string): Promise<Role | null> {
    return prisma.role.findUnique({ where: { name } });
  }

  async create(data: CreateRoleDto, trx?: TransactionClient): Promise<Role> {
    const client = trx ?? prisma;
    return client.role.create({ data });
  }

  async update(
    id: string,
    data: UpdateRoleDto,
    trx?: TransactionClient,
  ): Promise<Role | null> {
    const client = trx ?? prisma;
    const existing = await client.role.findUnique({ where: { id } });
    if (!existing) return null;

    const updateData: Prisma.RoleUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;

    return client.role.update({ where: { id }, data: updateData });
  }

  async delete(id: string, trx?: TransactionClient): Promise<boolean> {
    const client = trx ?? prisma;
    try {
      await client.role.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async setPermissions(
    roleId: string,
    permissionIds: string[],
    trx?: TransactionClient,
  ): Promise<void> {
    const client = trx ?? prisma;

    // Remove all existing role-permission mappings
    await client.rolePermission.deleteMany({ where: { roleId } });

    // Insert new mappings
    if (permissionIds.length > 0) {
      await client.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
        })),
      });
    }
  }
}
