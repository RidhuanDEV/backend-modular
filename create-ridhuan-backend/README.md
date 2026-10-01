# create-ridhuan-backend

Scaffold five modular backend templates with PostgreSQL or MySQL from one npm package. Template files are bundled; generation does not download source from GitHub.

## Start a project

```sh
npx create-ridhuan-backend@latest my-api --template nestjs --yes
npm create ridhuan-backend@latest my-api -- --template nestjs --yes
npm install -g create-ridhuan-backend@latest
create-ridhuan-backend my-api --template nestjs --yes
```

Omit `--yes` for the wizard. It masks password input; accepting an empty password generates a secret. Noninteractive setup generates secrets and never prints them. Read the ignored `.env` and `GETTING-STARTED.md` in the new project.

## Defaults and requirements

| Template | Host HTTP | Container HTTP | PostgreSQL host | Redis host | Development S3 host |
| --- | --- | --- | --- | --- | --- |
| Express TypeScript | 3000 | 3000 | 5432 | 6379 | MinIO 9000 |
| NestJS | 3000 | 3000 | 5432 | 6379 | MinIO 9000 |
| Go | 8080 | 8080 | 5432 | 6379 | MinIO 9000 |
| ASP.NET Core | 5080 | 8080 | 55432 | 56379 | S3Mock 19000 |
| FastAPI | 8000 | 8000 | 5432 | 6379 | MinIO 9000 |

MySQL host port defaults to 3306 for every framework. PostgreSQL remains the default engine. FastAPI manual setup requires Python 3.13.3 and uv 0.12.21 or newer; installation uses the locked dependency graph and only the selected driver.

The CLI supports Node 22.13+ or Node 24+. Express and NestJS require Node 24.15+ (below 27) for manual setup. Go/.NET requirements come from the bundled `go.mod`/`global.json`; use the exact supported SDK/toolchain shown in the generated guide. Go automatic toolchain selection is confined to child processes. `.NET` requires PowerShell 7 on Windows or Python 3 for its supplied env loader. Docker mode needs Docker Engine and Compose 2.24.4+, and skips host application dependency installation.

Redis and S3 are optional. Defaults use a single-instance memory limiter and local storage. Enable Redis for shared rate limits across API replicas. Selected development services are enabled by `COMPOSE_PROFILES`; remote S3 does not start a local fixture. Database/Redis/S3 development ports bind to loopback. `--port` changes manual and Compose host HTTP; container ports remain fixed.

## Options

Run `create-ridhuan-backend --help` for the complete contract.

| Option | Purpose |
| --- | --- |
| `--template`, `-t` | `express-typescript`, `nestjs`, `golang`, `dotnet`, `fastapi` (aliases `express`, `ts`, `nest`, `go`, `net`, `csharp`, `python`, `py`) |
| `--database` | `postgresql` (default) or `mysql`; chosen once when generating |
| `--yes`, `-y` | Accept defaults without prompting; Express is default |
| `--mode manual\|docker` | Install host dependencies or prepare Compose setup |
| `--no-install` | Generate files only; tool checks/install are deferred |
| `--port` | HTTP host/manual port, 1–65535 |
| `--db-host`, `--db-port`, `--db-name`, `--db-user` | Selected database settings for manual/hybrid startup |
| `--redis`, `--no-redis` | Enable/disable cache and shared limiter |
| `--storage local\|s3` | Upload adapter |
| `--s3-endpoint`, `--s3-docker-endpoint` | Host/container endpoint; custom provider settings are preserved |
| `--s3-region`, `--s3-bucket`, `--s3-access-key` | S3 settings |
| `--go-module` | Explicit module path for a Go project |
| `--help`, `--version` | Help and package version |

Use `RIDHUAN_DB_PASSWORD` and `RIDHUAN_S3_SECRET_KEY` environment variables for automated credential input. Do not put passwords in command arguments. Quotes, `$`, `#`, backslashes, spaces and Unicode are supported; newline and NUL are rejected.

A nonempty target or a symlink target is rejected. Installation failure preserves files/secrets and prints a recovery command. Configuration changes take effect after restart/redeployment.

## Run the generated application

Each project gets framework-specific manual and Compose steps in `GETTING-STARTED.md`: install, explicit migration, build, explicit seed, start, readiness and docs URLs. API startup never performs migrations or seed. Express uses Zod; NestJS uses class-validator/class-transformer/Swagger; Go uses Chi/Huma/sqlc/Goose; .NET uses ASP.NET Core/EF Core; FastAPI uses Pydantic/SQLAlchemy/Alembic. Auth, RBAC, audit, persisted notifications plus SSE, SMTP, uploads, optional Redis and OpenAPI follow each framework's source contracts.

## Maintainer verification

```sh
npm ci
npm run prepare:templates
npm run build
npm test
node scripts/verify-consumer.mjs express-typescript --runtime
node scripts/verify-consumer.mjs nestjs --runtime
node scripts/verify-consumer.mjs golang --runtime
node scripts/verify-consumer.mjs dotnet --runtime
node scripts/verify-compose.mjs express-typescript
node scripts/verify-compose.mjs nestjs
node scripts/verify-compose.mjs golang
node scripts/verify-compose.mjs dotnet
npm pack
```

Release snapshots require clean source repositories, explicit file manifests and source commit/hash provenance. `npm run prepare:templates -- --allow-dirty` is only for testing edits locally. Set `CLI_TARBALL` to test a specific artifact; consumer tests install that `.tgz` outside the checkout. CI validates the same artifact on Windows/Linux, performs macOS CLI smoke and Linux Compose acceptance, then allows an explicitly requested release. Publishing is a separate authorized step; do not publish development snapshots.

MIT © RidhuanDEV

Credential values containing backslashes use escaped JSON double quotes; literal dollar signs are escaped for Compose. Other special values use single quotes. The framework env loaders preserve these literal values and keep injected environment variables authoritative. Do not hand-edit generated escaping into shell syntax.

## Database selection

```sh
npm create ridhuan-backend@latest my-api -- --template fastapi --database mysql --yes
npm create ridhuan-backend@latest my-api -- --template golang --database postgresql --mode docker --yes
```

These options are part of the next source revision; use `latest` only after that revision is published. The generated `backend-template.json` records the engine and source provenance. Runtime rejects a provider mismatch. Changing env never converts existing tables/data; use a reviewed export/import process for database engine changes. Each framework owns its separate migration history. PostgreSQL histories are preserved; MySQL introduces an independent baseline.

MySQL Compose uses a dedicated application account and a separate generated root password. Its bootstrap helper sets arbitrary application credentials using server-side quoting before the network server starts. Environment secrets and upload files stay ignored. Use verified TLS and a trusted CA for external databases; the localhost Compose database is a development fixture.

## Verification matrix

`node scripts/verify-consumer.mjs <template> <postgresql|mysql> [--runtime]` installs the packed CLI, generates a project, installs dependencies and runs native checks. `node scripts/verify-compose.mjs <template> <postgresql|mysql>` exercises actual migration gating, preservation, auth, notifications/SSE, SMTP TLS, Redis and upload adapters. CI uses one tarball across all ten combinations on Windows/Linux and runs FastAPI install smoke checks on macOS. Configuring these jobs does not mean a remote CI run has passed. Public `npx @latest` acceptance requires the tested version to be published first.
