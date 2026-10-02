import type { Prisma, RefreshFamily } from "../../generated/prisma/client";
import { databaseProvider } from "../../platform/database/database-adapter";

export async function lockRefreshFamily(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<RefreshFamily | undefined> {
  const rows = await tx.$queryRawUnsafe<RefreshFamily[]>(
    databaseProvider() === "mysql"
      ? "SELECT * FROM `refresh_families` WHERE id = ? FOR UPDATE"
      : 'SELECT * FROM "refresh_families" WHERE id = $1::uuid FOR UPDATE',
    id,
  );
  return rows[0];
}
