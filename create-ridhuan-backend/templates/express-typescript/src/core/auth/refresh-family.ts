import type { Prisma, RefreshFamily } from "@prisma/client";
import { env } from "../../config/env.js";

export async function lockRefreshFamily(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<RefreshFamily | undefined> {
  const mysql = env.DB_PROVIDER === "mysql";
  const rows = await tx.$queryRawUnsafe<RefreshFamily[]>(
    mysql
      ? "SELECT * FROM `RefreshFamily` WHERE id = ? FOR UPDATE"
      : 'SELECT * FROM "RefreshFamily" WHERE id = $1 FOR UPDATE',
    id,
  );
  return rows[0];
}
