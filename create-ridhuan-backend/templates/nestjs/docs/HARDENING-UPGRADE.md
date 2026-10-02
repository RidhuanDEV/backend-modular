# NestJS hardening upgrade

Status: **implementation and local PostgreSQL/MySQL regression gates complete (2026-10-02)**. See the [verification evidence](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/BACKEND-HARDENING-TEST-RESULTS.md) for native, consumer, Compose and CI boundaries. Production load and backup restore have not been verified.

Default host HTTP port: 3000. Native auth response fields: `token` + `refreshToken`, under the existing success envelope.

## Auth and audit contracts

Access JWTs expire after 15 minutes. Refresh sessions use sliding 30 days from the successful server UTC rotation, with no absolute lifetime. Clients must coordinate one refresh in flight per session. A second simultaneous refresh is replay and revokes the entire family.

`POST /api/auth/logout` accepts `{ "refreshToken": "opaque-value" }`, returns **204 without a body**, and is idempotent for unknown or already-revoked families. A consumed pre-rotation token also logs out its family. Refresh/replay/logout lock the family before the token. Only hashes are stored. Revoked or expired tokens cannot revive a session. Previously issued JWTs continue until their expiry; this change adds no access-token blacklist.

Auth audit `required` shares the token/family transaction and rolls the mutation back on failure. `optional` failures are logged without breaking mutations. Unknown logout produces no mutation audit. Registry capability rejects unsupported overrides at startup; required GET audit remains unsupported. Snapshots contain public session state rather than tokens/hashes/passwords/file bytes.

## Notifications, cursor and email

Create body: `{ "recipientId": "uuid", "title": "Order update", "body": "Your order is ready", "sendEmail": true }`. The **201** notification DTO keeps existing fields, with `emailStatus: "PENDING"` when a durable email job is queued. SMTP disabled gives `FAILED` without an unprocessable job. `sendEmail: false` gives `NOT_REQUESTED`. Worker success becomes `SENT`; exhaustion becomes `FAILED`. Reading a notification does not cancel its email job.

Notification and immutable recipient/email payload snapshot commit together, one job per notification. A worker claims with `FOR UPDATE SKIP LOCKED`, uses a fenced renewable lease, and finishes without holding a transaction during SMTP. Defaults: concurrency 2; polling 3 seconds; lease 60 seconds; renewal 20 seconds; max 5 attempts; delays 5/30/120/600 seconds. Renewal must be less than half the lease. A recovered fifth attempt is failed, never sent a sixth time. SMTP is **at least once**: a crash after SMTP accepts an email but before the database completion can cause duplicate delivery. Do not promise exactly-once SMTP.

Use authenticated `fetch` for SSE, never a token in a URL:

```http
GET /api/notifications/stream
Authorization: Bearer <access-token>
Last-Event-ID: 123e4567-e89b-42d3-a456-426614174000
```

```text
id: 123e4567-e89b-42d3-a456-426614174001
event: notification
data: {"id":"123e4567-e89b-42d3-a456-426614174001", "emailStatus":"PENDING", ...}
```

Without a cursor, unread rows are drained in ascending sequence. A cursor replays **all** rows after it, including read rows. IDs on the wire remain notification UUIDs; sequence is internal and allocated by a per-recipient locked counter. Batches of 50 drain before polling again. Unknown/foreign cursors return 400 before SSE headers. Polling 3 seconds, heartbeat 15 seconds, connection maximum min(14 minutes, access expiry), stops on inactive account. Writes respect transport cancellation/backpressure, with no DB transaction held while sending.

`GET /api/notifications?cursor=<UUID>` preserves the existing array under `data`, uses descending sequence and returns up to 50. `X-Next-Cursor` contains the last returned UUID when more rows exist, otherwise absent. This header is exposed by CORS. Do not interpret UUIDs as order.

## Safe upgrade

1. Back up database, migration history and upload objects/metadata. Rehearse restoration in the separate testing task.
2. Pause old API replicas and old notification writers during migration/backfill. This upgrade requires coordinated rollout: old writers do not create family/counter records and must not remain beside the new schema.
3. Run the provider's release migrator **once**, then start new HTTP replicas and workers. Compose already waits for a successful migration. Seed remains explicit.
4. Existing family records are grouped from token history. Preserve existing expiry; all-consumed/revoked families remain revoked. A currently active family becomes sliding only on the next successful rotation. .NET's old absolute-cap column is retained for schema compatibility and no longer caps new rotations.
5. Existing notification sequence is backfilled by created date then ID for Express/NestJS/Go/.NET; existing FastAPI sequence values are preserved. Counter initialization uses the existing maximum only during the quiesced migration, never for live inserts.
6. Legacy `PENDING` notification rows have no durable email job and become `FAILED`, avoiding an automatic duplicate resend of a historical SMTP attempt. No historical email job is fabricated.

Historical migration contents/IDs are preserved; new migrations add families, strict token-family FK, recipient counters, sequence uniqueness and unique notification outbox FK plus claim/retention indexes. No token/session deletion occurs at API startup. MySQL DDL is not transactionally reversible as a whole: on a partial failure, inspect migration history/schema and recover using a tested backup procedure rather than blindly reapplying.

## Cleanup and retention

Cleanup is a separate scheduler job, never HTTP startup. Default **dry-run**, bounded batches of 500 per kind. Schedule repeatedly to drain a large backlog. The implementation supports multiple processes using database eligibility/locks and conditional deletion protect rows, object reference is queried again immediately before storage deletion, and local missing-object deletion is idempotent.

- Delete expired/revoked refresh families only after 30 additional days; consumed token hashes in active families are retained for replay detection.
- Delete terminal `SENT`/`FAILED` outbox jobs after 30 days. Keep pending/processing jobs.
- Orphan uploads have a default 24-hour grace period. Uploads use immutable UUID keys and are registered immediately; cleanup checks database references again immediately before deleting objects. Dry-run, grace, existing-reference protection and concurrent-cleaner scenarios pass. An external reference inserted precisely between the final check and object deletion has not been deterministically exercised.
- Audit deletion is disabled. To enable it, explicitly set both enable flag and retention days (suggested/default 365). Changing only the enable flag without a configured days value fails validation.
- Persisted notifications are not automatically deleted.

## Telemetry and deployment

Telemetry is optional and off by default. Official OpenTelemetry SDKs export HTTP, database, storage, Redis and email worker spans; bounded request/error/duration, SSE connection, outbox backlog/oldest age, email outcome/retry and cleanup metrics. Structured HTTP logs carry request ID plus trace ID. No request body, token/hash/password, SMTP credential, recipient address, object bytes or parameterized SQL is exported. Collector outages affect exporting only, never readiness.

Enable the `telemetry` Compose profile and enable telemetry in env, then redeploy. The Collector is an example using the official [Docker installation](https://opentelemetry.io/docs/collector/install/docker/) and `scripts/otel-collector.yaml`; its basic debug exporter is for demonstration, replace it with your chosen telemetry backend. API/worker do not depend on Collector health. Collector host ports default 4317/4318 and can be changed with `OTEL_GRPC_PORT`/`OTEL_HTTP_PORT`. Both provider Compose files include the worker and Collector profile. When SMTP is disabled, the worker remains idle until SIGINT/SIGTERM without connecting to the database or SMTP, so Compose `up --wait` still has a running service; shutdown grace is 60 seconds in Compose.

Redis remains optional for cache and email. Multiple HTTP replicas require Redis rate limiting; a cache-only Redis outage does not fail readiness. `/live` and `/ready` remain deployment probes.

## Native commands

Install dependencies and prepare native build/generated clients before using production commands. Migration is a release job; start HTTP and the worker in separate terminals. For .NET, `scripts/run.ps1` loads `.env`; Linux/macOS use `python3 scripts/run.py` with the same remaining arguments.

```sh
npm run prisma:migrate:deploy
# Separate worker terminal:
npm run worker
# Scheduled retention; review dry-run before applying:
npm run cleanup -- --dry-run
npm run cleanup -- --apply
```

To run cleanup in the built image, override its default HTTP command/entrypoint with the corresponding cleanup binary/script. Compose starts `worker` automatically after `migrate`; no HTTP process starts a worker internally. Do not start multiple migration jobs per replica.

### Env mapping

`WORKER_CONCURRENCY=2`, `WORKER_POLL_SECONDS=3`, `WORKER_LEASE_SECONDS=60`, `WORKER_RENEW_SECONDS=20`, `WORKER_MAX_ATTEMPTS=5`.

`CLEANUP_BATCH_SIZE=500`, `CLEANUP_SESSION_DAYS=30`, `CLEANUP_OUTBOX_DAYS=30`, `CLEANUP_AUDIT_ENABLED=false`, `CLEANUP_AUDIT_DAYS=365`, existing `UPLOAD_ORPHAN_GRACE_HOURS=24`.

`OTEL_ENABLED=false`, `OTEL_SERVICE_NAME=<template/project>`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (HTTP/protobuf). `OTEL_EXPORTER_OTLP_ENDPOINT_DOCKER=http://otel-collector:4318` is the container endpoint. Go keeps its existing official HTTP OTLP exporter; Express/NestJS/FastAPI add official SDK dependencies.
