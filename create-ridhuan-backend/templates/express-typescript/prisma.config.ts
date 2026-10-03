import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const provider = process.env.DB_PROVIDER ?? "postgresql";
if (provider !== "postgresql" && provider !== "mysql")
  throw new Error("DB_PROVIDER must be postgresql or mysql");

const url = new URL(env("DATABASE_URL"));
if (provider === "mysql" && url.searchParams.get("sslmode") === "verify-full")
  url.searchParams.set("sslaccept", "strict");

export default defineConfig({
  schema:
    provider === "mysql"
      ? "prisma/mysql/schema.prisma"
      : "prisma/schema.prisma",
  migrations: {
    path:
      provider === "mysql" ? "prisma/mysql/migrations" : "prisma/migrations",
  },
  datasource: {
    url: url.toString(),
  },
});
