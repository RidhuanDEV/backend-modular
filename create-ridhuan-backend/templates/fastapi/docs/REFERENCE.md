# Technical reference

Start with the [README](../README.md) for first-run setup. This guide keeps the detailed contracts, settings, examples, and operational reasoning behind the starter. Read [HARDENING-UPGRADE.md](HARDENING-UPGRADE.md) before applying migrations to existing data.

A typed FastAPI template for PostgreSQL or MySQL. It includes authentication, live RBAC, activity audit, uploads, optional Redis, persisted notifications, SSE and optional SMTP. Database migrations and seed operations are explicit.

## Start manually

Install Python 3.13.3 and [uv](https://docs.astral.sh/uv/getting-started/installation/) 0.12.21 or newer. Use an application-owned database.

```sh
uv sync --locked --extra postgresql
```

Copy `.env.example` to `.env`, configure PostgreSQL credentials and replace the JWT/admin/S3 placeholders with generated secrets. On Windows use `Copy-Item .env.example .env`; on Linux/macOS use `cp .env.example .env`.

```sh
uv run --locked backend migrate
uv run --locked backend seed
uv run --locked backend serve
```

API: `http://localhost:8000`. Swagger: `/docs`. OpenAPI: `/docs/openapi.json`; module documents: `/docs/specs/auth.json` and corresponding module names. `/live` checks HTTP; `/ready` checks the database and Redis only when rate limiting uses Redis. `/health` remains a lightweight alias.

For MySQL 8.4, use `.env.mysql.example`, `DB_PROVIDER=mysql`, and `uv sync --locked --extra mysql`. The chosen URL and provider must agree. Switching provider does not migrate an existing database's data. Keep each application/database's migration ownership separate.

## Docker Compose

```sh
docker compose up --build -d --wait
docker compose exec app backend seed
```

For a MySQL checkout, use `docker compose -f compose.mysql.yaml ...` for both commands. A CLI-generated MySQL project already has this variant as `compose.yaml`. Configure `.env` before starting. API containers run as a non-root user; the migration service runs once and must succeed before the API starts. Seed is never automatic. Outside Compose, run `backend migrate` as a release job before starting new replicas.

The runtime image has one Uvicorn process. Docker build uses the selected database extra and the locked dependencies. Database/Redis/MinIO development ports bind to loopback. Copy `compose.override.yaml.example` to `compose.override.yaml` to customize published ports; for MySQL override the `mysql` service's port rather than `postgres`.

## Architecture

```text
src/app/
  main.py                composition root and resource lifespan
  api/                   typed policies, dependencies, middleware, envelopes
  core/                  settings, clock, security, use-case context
  database/              engine, SQLAlchemy base and native type adapters
  modules/<feature>/     Pydantic DTO, router, service, repository, ORM model
  platform/              audit, Redis, cache, limiter, storage and SMTP
  cli/                   explicit operational commands
migrations/<provider>/versions/
contracts/               endpoint inventory and intentional differences
scripts/                 service-free verification and scaffolding
tests/                   unit/contract and actual database acceptance
```

Routers own HTTP; services own use cases and commit boundaries; repositories own queries. Public DTOs use explicit allowlists. An `AsyncSession` belongs to one request/task and is never shared by concurrent tasks. SSE opens short query sessions and never holds a transaction while sending data to a client.

## Configuration and extension

- Access tokens last 15 minutes. Refresh tokens are opaque, stored as SHA-256 hashes and rotated under a row lock. Reuse revokes the complete family. Signing keys, issuer and audience must remain consistent across replicas.
- Permissions are checked from live database grants. `manage_notifications` is separate from `manage_users` and `manage_uploads`. Listing, reading and streaming notifications are restricted to the authenticated recipient.
- `ENDPOINT_POLICIES_JSON` changes supported endpoint audit/cache/rate behavior through env and redeployment. Unknown IDs/options and unsupported transactional producers fail startup. Example: `{"user.get":{"cache":"off","rateLimit":"internal"},"user.create":{"audit":"required"}}`.
- Required audit commits in the same transaction as its mutation. Optional audit failure is logged; business persistence failures still propagate. Snapshots use public DTOs.
- `RATE_LIMIT_STORE=memory` is for one instance. Multiple replicas/workers require `redis` and `APP_INSTANCE_COUNT` accordingly. Auth limiter failures return 503; public/internal fallback is logged. Health probes bypass throttling so liveness remains independent of Redis.
- `CACHE_ENABLED=false` works without Redis. `user.get` is the cache example. Cache read/write failures fall back to the database; transactionally incremented database generations prevent stale cache resurrection after a mutation.
- All stored instants are UTC. PostgreSQL sessions use UTC; MySQL sessions use `+00:00` and `datetime(6)`. `core.clock.in_zone()` renders IANA zones such as `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura` and overseas DST zones.
- `CORS_ORIGINS` contains explicit origins. Production requires it. Requests without `Origin` remain valid, and cross-origin credentials are disabled.
- Local upload is the default. `UPLOAD_STORAGE=s3` uses the official boto3 SDK and MinIO/S3 settings. PNG/JPEG/PDF signatures and actual byte limits are checked. `backend cleanup` lists orphan candidates; `backend cleanup --apply` removes candidates older than the configured grace period after a metadata recheck.
- `SMTP_ENABLED=false` is the default. Failed/disabled email delivery leaves the notification in PostgreSQL/MySQL with `emailStatus=FAILED`. STARTTLS or implicit TLS verifies certificates. Use a trusted deployment CA rather than disabling validation.
- SSE supports `Last-Event-ID` for recipient-owned notification UUIDs. Inserts serialize per recipient and store a monotonic sequence, so polling cursors follow commit order. Batches are limited to 50; connections expire within 14 minutes or token expiry. Notifications remain available through the list API when disconnected.

Use database TLS and least-privilege accounts for deployed services. Set `DATABASE_TLS=verify-full` and optionally `DATABASE_CA_FILE=/absolute/path/to/ca.pem` for either engine; hostname and CA validation stay enabled. Both the API and Alembic use this connection factory. Development Compose credentials/settings are not deployment credentials.

## Checks

```sh
uv sync --locked --all-extras
uv run --locked python scripts/verify.py
uv run --locked backend check-migrations
```

`verify.py` requires no services. Migration drift checks and integration tests require a real selected database. Set `TEST_DB_PROVIDER` and `TEST_DATABASE_URL`, then run `uv run --locked pytest`. Tests do not substitute SQLite for PostgreSQL/MySQL. See `docs/OPERATIONS.md` for release, rollback and backup instructions. Local verification is not evidence of production load, backup restoration or a deployed service.

## Generate a module

```sh
uv run --locked backend generate-module products
uv run --locked python scripts/verify.py
uv run --locked backend revision add_products
# Review the generated migration before applying it.
uv run --locked backend migrate
```

The generator creates typed schemas, ORM model, repository, service and GET router, and registers its endpoint, model and composition imports. It uses the locked development Ruff tool to format its output automatically. Existing modules and entity name collisions are refused. Review authorization and create a migration against the selected engine before calling the generated route. For a reusable template that supports both engines, create and validate separate provider migrations. The generated read example caps its response at 100 items; add explicit pagination for your application.

MySQL application passwords are UTF-8. The aiomysql 0.3.2 boundary preserves their UTF-8 bytes despite the driver's internal latin1 conversion; real credential acceptance includes non-Latin passwords. Compose keeps credential bootstrap separate from API migrations.

## Hardening upgrade

Read [HARDENING-UPGRADE.md](HARDENING-UPGRADE.md) before migrating existing data. It documents sliding refresh/logout, ordered SSE replay, async email worker/outbox, retention commands and optional OpenTelemetry. Local PostgreSQL/MySQL regression and generated-consumer checks pass; [verification evidence](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/BACKEND-HARDENING-TEST-RESULTS.md) records the exact runtime and CI boundaries.
