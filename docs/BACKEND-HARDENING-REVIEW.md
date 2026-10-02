# Backend hardening — handoff review

Status: **implementasi dan pengujian lokal selesai; commit/push diizinkan; verifikasi CI berikutnya**.

Current verified results and remaining gates: [test evidence](BACKEND-HARDENING-TEST-RESULTS.md). The implementation checklist below records source delivery; it is not a substitute for that evidence.

Tasks 1–8 are implemented and local Task 9 gates pass for the CLI and five frameworks, each supporting PostgreSQL/MySQL. The source checklist and verified build/runtime results are recorded separately. Commit/push is authorized after these gates; versioning/npm publication remains separate.

## Checklist implementasi

| Task | Implementasi untuk review                                                                                                                                               | Status                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1    | 15m access JWT; sliding 30d refresh; authoritative family row/lock; consumed-token logout; replay revocation; Go/.NET logout endpoint; legacy backfill                  | Source complete                     |
| 2    | Locked recipient counter; ordered 50-item backlog; own UUID cursor; cancellation/lifetime/account checks; optional list cursor/header                                   | Source complete                     |
| 3    | Required transactional refresh/logout audit; optional safe logging; typed producer capability; rejected unsupported overrides; secret-free session snapshots            | Source complete                     |
| 4    | MySQL username32 / database64, PostgreSQL username63 / database63; distinct ASCII validation before generation; env/native initializer parity                           | Source complete                     |
| 5    | Atomic unique notification outbox; immutable email snapshot; separate SKIP LOCKED workers; fenced renewable leases; bounded retry/shutdown; ten Compose worker services | Source complete                     |
| 6    | Explicit batch500 dry-run/apply cleanup; inactive-family30d, terminal-outbox30d; orphan24h/ref recheck; audit opt-in365d; notifications retained                        | Source complete                     |
| 7    | Optional official OTel SDKs; safe HTTP/DB/storage/Redis/email spans; bounded metrics; request/trace log correlation; .NET transports; optional Collector                | Source complete                     |
| 8    | Additive migrations/models/FKs/indexes, native contract/OpenAPI/generator integration, env/docs/Docker/Compose, CLI development snapshots                               | Source complete                     |
| 9    | Native, database, concurrency, package, consumer, Compose, OS and CI verification                                                                                       | **Local gates pass; remote CI next** |

The accepted [plan](BACKEND-HARDENING-ENHANCEMENT-PLAN.md) tracks implementation. The [testing task](BACKEND-HARDENING-TEST-TASK.md) is the separate final task.

## Native architecture and diff guide

Each repository remains separate. Use `git status --short` to see new files as well as changes; `git diff` does not show untracked files. Root submodule/sibling changes and CLI snapshots belong to the root repository. Generated snapshots repeat source changes; review native source first.

| Repository  | Principal implementation                                                                                                                                     | Upgrade guide                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Express     | `src/modules/auth`, `src/modules/notifications`, `src/core/audit`, `src/core/jobs`, `src/core/observability`, `src/core/http`, `src/scripts`                 | [Express](../modular-express-typescript-starter-postgre/docs/HARDENING-UPGRADE.md) |
| NestJS      | Native class DTO/Swagger, modules/services/controllers, `common/endpoint`, `platform/jobs`, `common/observability`, `tools`                                  | [NestJS](../nestjs/docs/HARDENING-UPGRADE.md)                                      |
| Go          | `internal/auth`, `internal/notification`, `internal/jobs`, typed sqlc provider ports/decorators, Huma handlers/registry, `cmd/worker`, `cmd/cleanup-uploads` | [Go](../modular-golang/docs/HARDENING-UPGRADE.md)                                  |
| .NET        | Application/domain ports, EF stores/models, API controllers/registry/OpenAPI, Infrastructure jobs/interceptor/telemetry, dedicated Worker tool               | [.NET](../modular-NET/docs/HARDENING-UPGRADE.md)                                   |
| FastAPI     | Pydantic/native routers/services/context, SQLAlchemy models/locks, Alembic migrations, platform jobs/telemetry, backend CLI commands                         | [FastAPI](../modular-fastapi/docs/HARDENING-UPGRADE.md)                            |
| Unified CLI | Provider identifier validation, worker/cleanup getting-started instructions, explicit snapshot allowlists/provenance                                         | [CLI](../create-ridhuan-backend/README.md)                                         |

For each folder, inspect these commands locally without staging or releasing:

```powershell
git status --short
git diff --stat
git diff -- src
git diff -- prisma
git diff -- internal
```

Only use the applicable native directories. Newly added migrations/worker/docs are visible in status and can be opened directly.

## Contracts that change

### Auth

```http
POST /api/auth/logout
Content-Type: application/json

{"refreshToken":"opaque-value"}
```

Response: `204`, no body, for active, consumed or unknown token. A known token revokes its family; unknown tokens generate no fake mutation audit. Refresh/replay/logout serialize on the same family. Reusing a consumed token returns401 and revokes the family, including after that token's old expiry while the family is retained. Existing access JWTs remain valid until their 15m expiry; no per-session access blacklist is added.

Clients must coordinate one refresh in flight per session. A successful refresh extends family expiry to server UTC +30d; expired/revoked sessions are never reactivated. Concurrent second refresh is replay.

| Framework                  | Fields under existing success envelope                  |
| -------------------------- | ------------------------------------------------------- |
| Express / NestJS / FastAPI | `token`, `refreshToken`                                 |
| Go                         | `token`, `refreshToken`, `tokenType`, `expiresIn`       |
| .NET                       | `accessToken`, `refreshToken`, `tokenType`, `expiresIn` |

### Notifications/email

```http
POST /api/notifications
Authorization: Bearer <access-token>
Content-Type: application/json

{"recipientId":"123e4567-e89b-42d3-a456-426614174000","title":"Order update","body":"Your order is ready","sendEmail":true}
```

Response remains201 with the native notification DTO under `data`. Its `emailStatus` is `PENDING` after atomic enqueue, later `SENT`/`FAILED`; when SMTP is off it is `FAILED` with no unprocessable job. `sendEmail:false` keeps `NOT_REQUESTED`. API response no longer waits for SMTP. Snapshot recipient and payload cannot change when an account is edited after enqueue.

SMTP is **at least once**. A crash after the server acknowledges SMTP but before completion can send a duplicate after lease recovery. Defaults: concurrency2/poll3s/lease60s/renew20s/max5; retry5/30/120/600s. Expired fifth attempts becomeFAILED rather than a sixth delivery. SMTP off leaves workers idle until shutdown without database/SMTP work so Compose `up --wait` has a running worker service.

### SSE and list pagination

```http
GET /api/notifications/stream
Authorization: Bearer <access-token>
Last-Event-ID: 123e4567-e89b-42d3-a456-426614174000
```

```text
id: 123e4567-e89b-42d3-a456-426614174001
event: notification
data: {"id":"123e4567-e89b-42d3-a456-426614174001","emailStatus":"PENDING",...}
```

UUID event IDs are preserved; per-recipient sequence stays internal. No cursor drains unread rows, a valid cursor drains all later rows including read ones; batches50 drain before poll3s. Unknown/foreign UUID returns400 before SSE headers. Heartbeat15s, lifetime min(14m, JWT expiry), inactive account/cancellation/backpressure terminate streams. Never send JWTs through URL parameters.

`GET /api/notifications?cursor=<UUID>` retains the existing array inside `data`, descending order, up to50. `X-Next-Cursor` is the last returned UUID when another page exists, otherwise absent; CORS exposes it and native OpenAPI documents it.

## Worker / cleanup commands

Commands below are handoff examples and have **not** been executed as runtime tests. Install dependencies and prepare each native build/generated clients first. Start HTTP and worker in separate terminals. Compose already contains `worker`, depends on successful `migrate`, and has60s shutdown grace.

| Framework    | Separate worker                                                        | Cleanup dry-run                                                                            | Apply after checking candidates           |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Express      | `npm run worker`                                                       | `npm run cleanup -- --dry-run`                                                             | `npm run cleanup -- --apply`              |
| NestJS       | `npm run worker`                                                       | `npm run cleanup -- --dry-run`                                                             | `npm run cleanup -- --apply`              |
| Go           | `go run ./cmd/worker`                                                  | `go run ./cmd/cleanup-uploads --dry-run`                                                   | `go run ./cmd/cleanup-uploads --apply`    |
| .NET Windows | `pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Worker` | `pwsh -File scripts/run.ps1 run --project tools/ModularBackend.UploadCleanup -- --dry-run` | same command with `--apply`               |
| FastAPI      | `uv run --locked backend worker`                                       | `uv run --locked backend cleanup --dry-run`                                                | `uv run --locked backend cleanup --apply` |

.NET Linux/macOS uses `python3 scripts/run.py` instead of PowerShell with the same arguments. Generated namespace/project names follow CLI choices. Cleanup defaults to dry-run, uses bounded batches, retains active-family hash tombstones and pending/leased jobs, and rechecks upload references. Schedule it separately; no destructive cleanup runs on API startup. Persisted notifications are not deleted. Audit deletion requires explicit enable flag AND retention days.

## New configuration

All changes are env plus redeployment. Existing local `.env` files were preserved; copy reviewed settings from provider examples.

| Purpose             | Express/NestJS/Go/FastAPI                                                  | .NET                                                                    | Default                     |
| ------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| Worker              | `WORKER_CONCURRENCY/POLL_SECONDS/LEASE_SECONDS/RENEW_SECONDS/MAX_ATTEMPTS` | `Worker__Concurrency/PollSeconds/LeaseSeconds/RenewSeconds/MaxAttempts` | 2 / 3 / 60 / 20 / 5         |
| Cleanup             | `CLEANUP_BATCH_SIZE/SESSION_DAYS/OUTBOX_DAYS/AUDIT_ENABLED/AUDIT_DAYS`     | `Cleanup__BatchSize/SessionDays/OutboxDays/AuditEnabled/AuditDays`      | 500 / 30 / 30 / false / 365 |
| Orphan grace        | `UPLOAD_ORPHAN_GRACE_HOURS`                                                | `Upload__OrphanGraceHours`                                              | 24h                         |
| Telemetry           | `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`         | `Telemetry__Enabled/ServiceName/Endpoint/Protocol`                      | off                         |
| Collector/container | `OTEL_EXPORTER_OTLP_ENDPOINT_DOCKER`, `OTEL_HTTP_PORT`, `OTEL_GRPC_PORT`   | `Telemetry__Endpoint_DOCKER`, same Collector ports                      | HTTP4318 / gRPC4317         |

The grouped rows abbreviate repeated prefixes: for example `WORKER_POLL_SECONDS` and `Worker__PollSeconds` are full keys. Full keys are in each `.env.example` / `.env.mysql.example`. Renewal must be less than half the lease. Retry maximum is capped at5. Existing SMTP settings stay framework-native.

Telemetry adds official SDK dependencies to Node/Python and extends native Go/.NET SDKs. HTTP/DB/storage/Redis/email spans and bounded metrics do not export request bodies, token/hash/password/SMTP credentials, recipient addresses or SQL parameter values. HTTP logs correlate request/trace IDs; error logs use types instead of raw driver exceptions. HTTP error counters count5xx. Collector has optional `telemetry` profile, never readiness dependency. .NET keeps gRPC by default and supports `http/protobuf`; other templates use HTTP/protobuf.

## Migration impact

| Framework | PostgreSQL addition                                                        | MySQL addition                                                             |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Express   | `prisma/migrations/20261002000000_hardening`                               | `prisma/mysql/migrations/20261002000000_hardening`                         |
| NestJS    | same native Prisma migration paths/ID                                      | same native Prisma migration paths/ID                                      |
| Go        | `internal/db/migrations/00005_hardening.sql`                               | `internal/db/mysql/migrations/00004_hardening.sql`                         |
| .NET      | `Persistence/Migrations/20261002041841_Hardening` + designer/snapshot      | `Persistence/MySqlMigrations/20261002041927_Hardening` + designer/snapshot |
| FastAPI   | `migrations/postgresql/versions/0003_session_families_and_email_outbox.py` | `migrations/mysql/versions/0003_session_families_and_email_outbox.py`      |

Old migration contents/IDs were retained. New schema adds authoritative refresh families, token-family FK, recipient counters, unique recipient sequence, and unique notification→email-job FK/claim indexes. Backfill preserves family expiry; a family with only consumed/revoked history remains revoked. Expired tokens stay expired. Sliding begins on the next valid rotation. .NET's legacy `FamilyExpiresAt` column remains but no longer caps rotation.

Express/NestJS/Go/.NET sequence backfill is by created time then ID. Existing FastAPI sequences stay unchanged; counters initialize from retained sequence only during migration. Historical `PENDING` notifications becomeFAILED because they have no durable job; no fabricated resend jobs are created.

**Coordinated upgrade:** back up DB/history/objects; pause old API/notification writers; run one release migration; then start new HTTP/worker processes; seed stays explicit. Old writers lack family/counter inserts and must not run alongside the changed schema. MySQL DDL is not one rollbackable transaction; inspect/recover partial upgrades rather than blindly rerun. Database provider switching does not convert existing data.

## Preparation performed and verification deferred

Performed as implementation: dependency/lock resolution, source formatting, Prisma clients/diff scaffolding, sqlc native ports/decorators, Alembic/Goose-native migration sources, and official EF scaffolding/designer/model snapshots. **EF scaffolding compiled Infrastructure as its required tool step; it is not a completed application build/test gate.** Development snapshots copy selected source and record dirty provenance/checksums; this is not consumer/runtime acceptance. CLI built distribution remains the prior build until Task9.

Not run for this change:

- [ ] Application build/typecheck/lint, native unit/integration/API-contract verification.
- [ ] Fresh or upgrade migration execution on PostgreSQL/MySQL.
- [ ] Auth/audit/SSE concurrency, expiry, retention and failure injection.
- [ ] SMTP retry/recovery/multi-worker/lease and duplicate-delivery scenarios.
- [ ] Cleanup dry-run/apply/concurrency/ref recheck and telemetry/redaction/exporter-outage tests.
- [ ] Packed CLI generation→install→build for ten combinations, package/checksum/dependency/secret audit.
- [ ] Ten Compose image/migration/worker/seed/root/live/ready/outage combinations.
- [ ] Windows/Linux consumers, macOS smoke and remote CI.

**Next gate:** user reviews Tasks1–8 and requests tests. Then execute [Task9](BACKEND-HARDENING-TEST-TASK.md), repair proven failures and report evidence. Commit/push/version/publication are subsequent release instructions; these changes are not ready to publish on the strength of source inspection alone.
