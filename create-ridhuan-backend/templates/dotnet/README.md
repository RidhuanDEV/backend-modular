# Modular .NET Backend

A typed backend starter for teams building a new API with **PostgreSQL or MySQL**. It gives you ASP.NET Core 10 and EF Core, connected authentication and permissions, and explicit database and worker commands so you can start with application features.

[![CI](https://github.com/RidhuanDEV/NET-backend/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RidhuanDEV/NET-backend/actions/workflows/ci.yml)
[![.NET](https://img.shields.io/badge/.NET-10-blue?style=flat-square)](https://github.com/RidhuanDEV/NET-backend) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169e1?style=flat-square)](.env.example) [![MySQL](https://img.shields.io/badge/MySQL-8.4-4479a1?style=flat-square)](.env.mysql.example) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

Read this in [Bahasa Indonesia](README.id.md).

**Start here:** [Requirements](#requirements) · [Quick start](#quick-start) · [Docker](#docker-quick-start) · [API docs](#api-documentation) · [Structure](#project-structure) · [Guides](#documentation).

## Features

- Typed public request/response contracts and feature boundaries.
- JWT access tokens, rotating opaque refresh tokens, and database-backed permissions (RBAC).
- Transactional audit logging for required mutations.
- Persisted notifications and Server-Sent Events (SSE) for recipient updates.
- A separate SQL email outbox worker with retry and lease recovery; SMTP is optional.
- Local or S3-compatible file storage with validation and explicit cleanup.
- Optional Redis caching and shared rate limiting.
- Separate provider migration histories, explicit seeding, health probes, and API docs.
- Docker Compose and tests against real PostgreSQL/MySQL databases.

## Requirements

| Run mode | You need |
| --- | --- |
| Manual | .NET SDK 10.0.401; PowerShell 7 on Windows or Python 3 for the local env loader, plus an application-owned database |
| Docker | Docker Engine/Desktop using Linux containers and Docker Compose v2; host application SDKs are not required |
| Optional features | Redis for shared quotas/cache; S3 storage and SMTP only when enabled |

Compose fixtures use PostgreSQL 18 and MySQL 8.4. These are the checked-in fixture versions, not a blanket minimum-version claim for other deployments. Native requirements and locks belong to this framework.

## Quick start

Run these commands from the framework checkout or generated project. If the CLI already generated your project, keep its ignored `.env` and follow `GETTING-STARTED.md`; do not overwrite generated secrets.

### 1. Install dependencies

```sh
pwsh -File scripts/run.ps1 restore --locked-mode
```

### 2. Configure your database and secrets

For a new PostgreSQL checkout:

```sh
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Create a database owned by this application and edit `.env`: set **Jwt__Secret, Bootstrap__Password, and matching database credentials**. Keep connection passwords consistent with your database service. Generate strong independent secrets; never use example values for deployment. Production requires explicit allowed browser origins.

The local helpers load `.env`; .NET does not load it automatically. On Linux/macOS replace `pwsh -File scripts/run.ps1` with `python3 scripts/run.py`, preserving the remaining arguments.

### 3. Migrate, seed, and start

```powershell
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Migrator
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Seeder
pwsh -File scripts/run.ps1
```

Migrations run explicitly before new API replicas. Seed is a separate command; HTTP startup never changes the schema or creates accounts. Open [http://localhost:5080/docs](http://localhost:5080/docs) after the server starts.

### MySQL setup

```sh
cp .env.mysql.example .env
```

On PowerShell use `Copy-Item .env.mysql.example .env`. Configure the MySQL provider and connection credentials, then use the migrate/seed/start commands above.

Provider selection does not convert existing data. Never apply one framework's migration history to another application's database.

## Docker quick start

For a fresh source checkout, copy `.env.example` (or `.env.mysql.example` for MySQL) to `.env` and fill in the secrets described above. If the CLI already created `.env`, keep it. Laravel needs an independent APP_KEY and JWT_SECRET; the native initializer or CLI can generate them.

### PostgreSQL

```sh
docker compose up --build -d --wait
docker compose --profile seed run --rm seeder
```

### MySQL source checkout

```sh
docker compose -f compose.mysql.yaml up --build -d --wait
docker compose -f compose.mysql.yaml --profile seed run --rm seeder
```

A CLI-generated MySQL project already uses the selected provider as its active Compose file, so follow `GETTING-STARTED.md` with ordinary `docker compose` commands. Compose waits for migration success and runs a separate worker; seed remains explicit. API containers run without root privileges. Development dependency ports bind to localhost.

## API documentation

At the default API port **5080**:

| Path | Purpose |
| --- | --- |
| `/docs` | API documentation index (links to specs) |
| `/docs/openapi.json` | Complete OpenAPI specification |
| `/docs/specs/user.json` | Example module-specific specification |
| `/live` | HTTP/process liveness |
| `/ready` | Required database and distributed-quota dependencies |
| `/health` | Lightweight compatibility health endpoint |

The docs paths are explicitly implemented by this template. Login/refresh returns the access token as `data.accessToken` and the refresh credential as `data.refreshToken`. Protected requests use `Authorization: Bearer <access-token>`.

## Project structure

```text
src/ModularBackend.Api/            # HTTP controllers, DTO binding, middleware, and DI
src/ModularBackend.Application/    # Use cases and explicit ports
src/ModularBackend.Domain/         # Entities without infrastructure dependencies
src/ModularBackend.Infrastructure/ # EF Core, Redis, and SDK implementations
tools/                            # Migrator, seeder, worker, cleanup, initializer
scripts/                          # Cross-platform environment loaders
tests/                            # Unit, contract, and integration checks
docs/                             # Module and operating guides
```

### Responsibility boundaries

Api owns HTTP and dependency injection. Application owns use cases and ports. Infrastructure implements them with EF Core and SDKs. Domain has no infrastructure dependency. The starter uses BackendService/BackendStore rather than claiming every feature is already a separate module.

## Configuration and security

| Topic | What you need to know |
| --- | --- |
| Authentication | Access tokens last 15 minutes. Refresh tokens rotate; replay revokes their family. Keep signing settings consistent across replicas. |
| Permissions | Authorization reads current database grants, not stale client permissions. Grant new rights deliberately. |
| Audit | Required audit and its mutation share a transaction. Public snapshots exclude secrets. |
| Rate limiting | A local limiter is for one instance. Multiple API replicas require a shared Redis limiter and the framework's replica-count setting. |
| Cache | Redis cache is optional. Cache failure falls back to database reads; authorization stays authoritative. |
| Time and CORS | Store instants in UTC and format at presentation boundaries. Configure exact browser origins for production. |
| Environment | Keep secrets out of Git/logs. Changes require restart or redeployment. |

The complete keys are in [.env.example](.env.example) and [.env.mysql.example](.env.mysql.example). See [technical reference](docs/REFERENCE.md) for endpoint policy, cache generation, provider, proxy, and audit details.

## Notifications, email, and storage

Notifications belong to their recipient. SSE streams persisted events using recipient-owned cursors and bounded batches; they do not keep a database transaction open while sending. Reconnect after token expiry using an authenticated stream, never a token in a URL. Large client counts require deployment-specific capacity tests.

SMTP is off by default. To process enabled email in manual mode, start a separate terminal after the native build:

```powershell
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Worker
```

The included outbox worker handles retries and lease recovery. SMTP is **at least once**: a crash after SMTP accepts an email can cause duplicate delivery.

Uploads validate configured size and file signatures. Local/S3 storage and SQL cannot share one transaction; compensation and grace-period cleanup reduce orphaned objects. Cleanup is a separate command, dry-run first, never an API startup task. See the reference and upgrade guide for download semantics, retention, and cleanup commands.

## Add a module

Follow [the .NET module guide](docs/ADDING-MODULES.md). Define the use case and public contract, add the selected provider migration, register its endpoint/policy, and grant its permission explicitly.

## Testing

```sh
dotnet restore --locked-mode
dotnet build -c Release --no-restore -warnaserror
dotnet format --verify-no-changes --no-restore
dotnet test ModularBackend.slnx -c Release --no-build
```

Service-free checks and database acceptance are different. Integration checks need real PostgreSQL/MySQL and enabled external services; skipped or inconclusive tests are not passes. Use disposable test databases, not production data.

## Production and upgrades

Configure database TLS with hostname/CA validation, trusted ingress/proxies, exact CORS origins, secret storage, backups, and matched upload restoration. Local Docker dependency settings are development fixtures. Non-root containers, passing CI, and readiness probes do not establish production capacity, high availability, or a tested recovery procedure.

**Before applying migrations to persisted data**, read [HARDENING-UPGRADE.md](docs/HARDENING-UPGRADE.md). It covers sliding refresh sessions/logout, ordered SSE replay, the async outbox worker, retention, optional OpenTelemetry, and coordinated migration considerations.

## Documentation

| Document | Purpose |
| --- | --- |
| [Technical reference](docs/REFERENCE.md) | Detailed contracts, settings, examples, and implementation reasoning |
| [Hardening upgrade](docs/HARDENING-UPGRADE.md) | Read before changing an existing installation |
| [docs/ADDING-MODULES.md](docs/ADDING-MODULES.md) | Adding a module with official EF tooling |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | HTTP contracts and intentional differences |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Release, database TLS, backup, and restoration |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Official packages and provider licensing |
| `GETTING-STARTED.md` (CLI-generated projects) | Commands matching your chosen framework, database, ports, and run mode |

## License

[MIT](LICENSE). Source: [RidhuanDEV/NET-backend](https://github.com/RidhuanDEV/NET-backend).

## Code formatting

Install development dependencies, then use the native project formatter:

```sh
dotnet format whitespace ModularBackend.slnx --exclude src/ModularBackend.Infrastructure/Persistence/Migrations src/ModularBackend.Infrastructure/Persistence/MySqlMigrations
dotnet format whitespace ModularBackend.slnx --verify-no-changes --exclude src/ModularBackend.Infrastructure/Persistence/Migrations src/ModularBackend.Infrastructure/Persistence/MySqlMigrations
```

The workspace formatting workflow preserves released migration history.
