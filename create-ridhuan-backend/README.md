# create-ridhuan-backend

Interactive CLI to scaffold production-ready modular backend starters with PostgreSQL:
- **Express TypeScript** (Express 5, Prisma, Zod, JWT/RBAC, OpenAPI)
- **NestJS** (NestJS 12, Prisma, class-validator, JWT/RBAC, OpenAPI)
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
  NestJS (Prisma, class-validator, JWT, RBAC, PostgreSQL)
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

# NestJS
npm create ridhuan-backend my-nest-api --template nestjs --yes

# .NET 10
npm create ridhuan-backend MyDotnetApi --template dotnet --yes
```

### Options

| Flag | Shorthand | Description |
| :--- | :--- | :--- |
| `--template <name>` | `-t` | Choose template (`express-typescript`, `nestjs`, `golang`, `dotnet`) |
| `--yes` | `-y` | Accept all defaults without interactive prompts |
| `--no-install` | | Skip automatic dependency download |

---

## Template Comparison

| Feature | Express TypeScript | NestJS | Golang | .NET 10 |
| :--- | :--- | :--- | :--- | :--- |
| **Runtime** | Node.js 24+ | Node.js 24.15+ | Go 1.27+ | .NET 10 SDK |
| **Framework** | Express 5 | NestJS 12 | Chi + Huma v2 | ASP.NET Core |
| **Database** | PostgreSQL 18 | PostgreSQL 18 | PostgreSQL 18 | PostgreSQL 18 |
| **Data access** | Prisma | Prisma | sqlc | EF Core / Npgsql |
| **DTO validation** | Zod | class-validator | Huma | ASP.NET validation |
| **Docs** | OpenAPI & Swagger UI | OpenAPI & Swagger UI | OpenAPI & Swagger UI | Microsoft OpenAPI |
| **Notifications** | PostgreSQL + SSE | PostgreSQL + SSE | PostgreSQL + SSE | PostgreSQL + SSE |

The CLI installs dependencies unless `--no-install` is given. For NestJS, edit the generated `.env`, run migrations, build, and seed before serving requests. The packaged NestJS snapshot comes from the separate `modular-nestjs` repository; publishing this CLI is a separate release step.

---

## License

MIT © RidhuanDEV
