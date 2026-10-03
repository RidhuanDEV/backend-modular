import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { CreateUserDto } from "./dto/create-user.dto.js";
import type { UpdateUserDto } from "./dto/update-user.dto.js";
import type { PrismaFindOptions } from "../../core/database/query-builder.js";
import { nowUtc } from "../../core/time/time.js";

type TransactionClient = Prisma.TransactionClient;

/** User with eager-loaded role and its permissions */
export type UserWithRole = Prisma.UserGetPayload<{
  include: {
    role: {
      include: {
        permissions: {
          include: { permission: true };
        };
      };
    };
  };
}>;

export class UserRepository {
  async findAll(
    options: PrismaFindOptions,
  ): Promise<{ rows: UserWithRole[]; count: number }> {
    const [rows, count] = await Promise.all([
      prisma.user.findMany({
        where: { ...options.where, deletedAt: null },
        skip: options.skip,
        take: options.take,
        orderBy: options.orderBy,
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      }),
      prisma.user.count({ where: { ...options.where, deletedAt: null } }),
    ]);
    return { rows, count };
  }

  async findById(
    id: string,
    trx?: TransactionClient,
  ): Promise<UserWithRole | null> {
    const client = trx ?? prisma;
    return client.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });
  }

  async create(data: CreateUserDto, trx?: TransactionClient): Promise<User> {
    const client = trx ?? prisma;
    return client.user.create({
      data: {
        email: data.email,
        password: data.password,
        roleId: data.roleId,
      },
    });
  }

  async update(
    id: string,
    data: UpdateUserDto,
    trx?: TransactionClient,
  ): Promise<User | null> {
    const client = trx ?? prisma;

    const existing = await client.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return null;

    const updateData: Prisma.UserUpdateInput = {};
    if (data.email !== undefined) updateData.email = data.email;
    if (data.roleId !== undefined)
      updateData.role = { connect: { id: data.roleId } };

    return client.user.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string, trx?: TransactionClient): Promise<void> {
    const client = trx ?? prisma;
    await client.user.update({
      where: { id },
      data: { deletedAt: nowUtc() },
    });
  }
}
