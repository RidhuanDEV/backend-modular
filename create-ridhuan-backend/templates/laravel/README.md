# Modular Laravel

A typed backend starter for teams building a new API with **PostgreSQL or MySQL**. It gives you Laravel 13, Eloquent, FormRequests, readonly DTOs, Resources, and gates, connected authentication and permissions, and explicit database and worker commands so you can start with application features.

[![CI](https://github.com/RidhuanDEV/modular-laravel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/RidhuanDEV/modular-laravel/actions/workflows/ci.yml)
[![PHP](https://img.shields.io/badge/PHP-8.5-blue?style=flat-square)](https://github.com/RidhuanDEV/modular-laravel) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169e1?style=flat-square)](.env.example) [![MySQL](https://img.shields.io/badge/MySQL-8.4-4479a1?style=flat-square)](.env.mysql.example) [![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

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
| Manual | 64-bit PHP 8.5 and Composer 2.9.8+, with the selected PDO driver and required extensions, plus an application-owned database |
| Docker | Docker Engine/Desktop using Linux containers and Docker Compose v2; host application SDKs are not required |
| Optional features | Redis for shared quotas/cache; S3 storage and SMTP only when enabled |

Compose fixtures use PostgreSQL 18 and MySQL 8.4. These are the checked-in fixture versions, not a blanket minimum-version claim for other deployments. Native requirements and locks belong to this framework.

## Quick start

Run these commands from the framework checkout or generated project. If the CLI already generated your project, keep its ignored `.env` and follow `GETTING-STARTED.md`; do not overwrite generated secrets.

### 1. Install dependencies

```sh
composer install --no-interaction --prefer-dist
php artisan backend:initialize --provider=postgresql --port=8000
```

Initialization creates fresh secrets and refuses to replace an existing `.env`. Required PHP extensions are listed in [setup](docs/SETUP.md); there is no SQLite fallback.

### 2. Configure your database and secrets

Create a database owned by this application and edit `.env`: set **APP_KEY, a distinct JWT_SECRET, ADMIN_PASSWORD, and matching database credentials**. Keep connection passwords consistent with your database service. Generate strong independent secrets; never use example values for deployment. Production requires explicit allowed browser origins.

### 3. Migrate, seed, and start

```sh
php artisan backend:migrate --force
php artisan backend:seed
composer build
php artisan backend:validate-config
php artisan serve --host=127.0.0.1 --port=8000
```

Migrations run explicitly before new API replicas. Seed is a separate command; HTTP startup never changes the schema or creates accounts. Open [http://localhost:8000/docs](http://localhost:8000/docs) after the server starts.

### MySQL setup

For a fresh project, use `php artisan backend:initialize --provider=mysql --port=8000` instead of the PostgreSQL initializer. Configure its dedicated MySQL database before running the migrate/seed/start commands.

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

At the default API port **8000**:

| Path | Purpose |
| --- | --- |
| `/docs` | API documentation viewer |
| `/docs/openapi.json` | Complete OpenAPI specification |
| `/docs/specs/user.json` | Example module-specific specification |
| `/live` | HTTP/process liveness |
| `/ready` | Required database and distributed-quota dependencies |
| `/health` | Lightweight compatibility health endpoint |

The docs paths are explicitly implemented by this template. Login/refresh returns the access token as `data.token` and the refresh credential as `data.refreshToken`. Protected requests use `Authorization: Bearer <access-token>`.

## Project structure

```text
app/Modules/               # Native feature requests, DTOs, resources, services, policies
app/Infrastructure/        # Storage, messaging, and platform integrations
app/Support/               # Shared contracts, endpoint registry, and configuration
app/Console/               # Explicit Artisan operational commands
database/                  # Separate provider migrations and seeding
routes/                    # Registry-backed route wiring
public/                    # Private-safe HTTP document root
config/, bootstrap/        # Laravel configuration and composition
docs/, scripts/, tests/    # Guides, verification tools, and tests
```

### Responsibility boundaries

FormRequests validate HTTP input. Readonly DTOs carry use-case data. Services own business rules and transactions. Eloquent models own persistence; Resources explicitly select public fields and gates enforce permissions. Native Artisan commands own migrations, seed, worker, cleanup, and module generation.

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

```sh
php artisan notifications:work
```

The included outbox worker handles retries and lease recovery. SMTP is **at least once**: a crash after SMTP accepts an email can cause duplicate delivery.

Uploads validate configured size and file signatures. Local/S3 storage and SQL cannot share one transaction; compensation and grace-period cleanup reduce orphaned objects. Cleanup is a separate command, dry-run first, never an API startup task. Keep S3_PREFIX dedicated to one application database. See the reference and upgrade guide for download semantics, retention, and cleanup commands.

## Add a module

```sh
php artisan make:backend-module Invoice
php artisan backend:verify-contract
php artisan backend:openapi-export
```

The generator is a scaffold, not your business contract. Review fields, response DTOs, permissions, registry wiring, and provider migration drafts before using a new route.

## Testing

```sh
composer build
composer analyse
php vendor/bin/pint --test
php vendor/bin/phpunit
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
| [docs/SETUP.md](docs/SETUP.md) | Extensions, credentials, provider, and storage setup |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Native boundaries and contracts |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | PHP-FPM/Nginx, capacity boundaries, and deployment |
| [docs/UPGRADE.md](docs/UPGRADE.md) | Migration and compatibility guidance |
| [docs/TESTING.md](docs/TESTING.md) | Verification commands and limits |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Recorded acceptance evidence |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Official dependencies and licenses |
| `GETTING-STARTED.md` (CLI-generated projects) | Commands matching your chosen framework, database, ports, and run mode |

## License

[MIT](LICENSE). Source: [RidhuanDEV/modular-laravel](https://github.com/RidhuanDEV/modular-laravel).
