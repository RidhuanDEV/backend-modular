import { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { PageQueryDto } from "../../common/dto/pagination.dto";

export async function textSearchPage(
  client: PrismaClient,
  table: "roles" | "permissions" | "users",
  query: PageQueryDto,
): Promise<{ ids: string[]; total: number }> {
  const pattern = `%${(query.search ?? "").replace(/[\\%_]/g, (character) => `\\${character}`).toLowerCase()}%`;
  const allowed =
    table === "users"
      ? ["email", "createdAt", "updatedAt"]
      : ["name", "createdAt", "updatedAt"];
  const sort = allowed.includes(query.sortBy) ? query.sortBy : "createdAt";
  const quote = (column: string): Prisma.Sql =>
    Prisma.raw(
      process.env.DB_PROVIDER === "mysql"
        ? "`" + column + "`"
        : '\"' + column + '\"',
    );
  const name = Prisma.raw(table);
  const condition = Prisma.sql`LOWER(${quote(table === "users" ? "email" : "name")}) LIKE ${pattern}${table === "users" ? Prisma.sql` AND ${quote("deletedAt")} IS NULL` : Prisma.empty}`;
  const order =
    query.orderBy === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  const [rows, counts]: readonly unknown[] = await client.$transaction([
    client.$queryRaw(
      Prisma.sql`SELECT id FROM ${name} WHERE ${condition} ORDER BY ${quote(sort)} ${order}, id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    ),
    client.$queryRaw(
      Prisma.sql`SELECT COUNT(*) AS total FROM ${name} WHERE ${condition}`,
    ),
  ]);
  if (!Array.isArray(rows) || !Array.isArray(counts))
    throw new Error("Invalid search result");
  const count: unknown = counts[0];
  if (
    !count ||
    typeof count !== "object" ||
    !("total" in count) ||
    !["number", "bigint"].includes(typeof count.total)
  )
    throw new Error("Invalid search count");
  const total = Number(count.total);
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("Search count exceeds supported range");
  const ids = rows.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      typeof row.id !== "string"
    )
      throw new Error("Invalid search ID");
    return row.id;
  });
  return { ids, total };
}
