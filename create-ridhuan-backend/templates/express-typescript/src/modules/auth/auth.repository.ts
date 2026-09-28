import type { Prisma, User, Role } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

type TransactionClient = Prisma.TransactionClient;

export class AuthRepository {
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async emailExists(email: string): Promise<boolean> {
    const count = await prisma.user.count({ where: { email } });
    return count > 0;
  }

  async findRoleByName(name: string): Promise<Role | null> {
    return prisma.role.findUnique({ where: { name } });
  }

  async createUser(
    data: {
      email: string;
      password: string;
      roleId: string;
    },
    trx?: TransactionClient,
  ): Promise<User> {
    const client = trx ?? prisma;
    return client.user.create({ data });
  }
}
