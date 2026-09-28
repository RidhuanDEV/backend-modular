import type { Prisma, Permission } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type {
  CreatePermissionDto,
  UpdatePermissionDto,
} from "./permission.schema.js";

type TransactionClient = Prisma.TransactionClient;

export class PermissionRepository {
  async findAll(): Promise<Permission[]> {
    return prisma.permission.findMany();
  }

  async findById(id: string, trx?: TransactionClient): Promise<Permission | null> {
    const client = trx ?? prisma;
    return client.permission.findUnique({ where: { id } });
  }

  async findByName(name: string): Promise<Permission | null> {
    return prisma.permission.findUnique({ where: { name } });
  }

  async create(
    data: CreatePermissionDto,
    trx?: TransactionClient,
  ): Promise<Permission> {
    const client = trx ?? prisma;
    return client.permission.create({ data });
  }

  async update(
    id: string,
    data: UpdatePermissionDto,
    trx?: TransactionClient,
  ): Promise<Permission | null> {
    const client = trx ?? prisma;
    const existing = await client.permission.findUnique({ where: { id } });
    if (!existing) return null;

    const updateData: Prisma.PermissionUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;

    return client.permission.update({ where: { id }, data: updateData });
  }

  async delete(id: string, trx?: TransactionClient): Promise<boolean> {
    const client = trx ?? prisma;
    try {
      await client.permission.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
