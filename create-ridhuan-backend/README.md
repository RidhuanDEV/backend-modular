# create-ridhuan-backend

Interactive CLI to scaffold production-ready modular backend starters with PostgreSQL:
- **Express TypeScript** (Express 5, Prisma, Zod, JWT/RBAC, OpenAPI)
- **Golang** (Chi, Huma, sqlc, JWT/RBAC, Goose, OpenAPI)
- **.NET 10** (ASP.NET Core 10, EF Core / Npgsql, JWT/RBAC, OpenAPI)

---

## Quick Start

Run in your terminal:

```bash
npm create ridhuan-backend
```

Or using `npx`:

```bash
npx create-ridhuan-backend
```

You will see an interactive prompt with arrow key navigation:

```text
? Select a backend framework / template: (Use arrow keys, press Enter)
❯ Express TypeScript (Prisma, Zod, JWT, RBAC, PostgreSQL)
  Golang (Chi, Huma, sqlc, JWT, PostgreSQL)
  .NET 10 (ASP.NET Core, EF Core / Npgsql, JWT, PostgreSQL)
```

---

## Non-Interactive & CLI Flags

You can specify the project name and template directly via flags:

```bash
# Express TypeScript
npm create ridhuan-backend my-express-api --template express-typescript --yes

# Golang
npm create ridhuan-backend my-go-api --template golang --yes

# .NET 10
npm create ridhuan-backend MyDotnetApi --template dotnet --yes
```

### Options

| Flag | Shorthand | Description |
| :--- | :--- | :--- |
| `--template <name>` | `-t` | Choose template (`express-typescript`, `golang`, `dotnet`) |
| `--yes` | `-y` | Accept all defaults without interactive prompts |
| `--no-install` | | Skip automatic dependency download |

---

## Template Comparison

| Feature | Express TypeScript | Golang | .NET 10 |
| :--- | :--- | :--- | :--- |
| **Language & Runtime** | Node.js 24+ / TypeScript | Go 1.27+ | .NET 10 SDK / C# 14 |
| **HTTP Framework** | Express 5 | Chi + Huma v2 | ASP.NET Core Minimal APIs / Controllers |
| **Database** | PostgreSQL 18 | PostgreSQL 18 | PostgreSQL 18 |
| **ORM / Query Engine** | Prisma ORM | sqlc (Type-safe SQL) | EF Core / Npgsql |
| **Auth & RBAC** | JWT + Database RBAC | JWT + Database RBAC | JWT + Database RBAC |
| **API Docs** | OpenAPI 3.1 & Swagger UI | OpenAPI 3.1 & Swagger UI | OpenAPI 3.1 & Scalar / Swagger |
| **Docker** | Compose (App + Postgres + Redis + MinIO) | Compose (App + Postgres + Redis + MinIO) | Compose (App + Postgres + Redis + MinIO) |

---

## License

MIT © RidhuanDEV
