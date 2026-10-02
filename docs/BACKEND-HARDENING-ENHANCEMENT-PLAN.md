# Rencana Hardening dan Enhancement Lima Template Backend

Status: **implementasi, review, pengujian lokal, commit dan push ke main selesai; seluruh CI final lulus pada 2026-10-03**. Tasks 1–8 are implemented; Task 9 local gates and the initial complete Windows/Linux/macOS CI matrix pass. Native CI fixture repairs and final run evidence are recorded in the test results. npm version bump/publication is a separate release action.

## Accepted decisions

- Express, NestJS, Go, .NET and FastAPI; PostgreSQL and MySQL.

- Access token 15 minutes. Refresh uses sliding 30 days without an absolute lifetime.

- Preserve existing sessions without reviving expired/revoked tokens.

- SMTP delivery uses a database outbox and a separate async worker; Redis is optional.

- Configuration is env plus redeployment. Keep native framework architecture and strict contracts.

## Implementation checklist

- [x] Task 1: Auth/logout parity, family record, atomic family locking, sliding expiry, replay revocation and old-session backfill.

- [x] Task 2: Persisted per-recipient sequence/counter, backlog batches of 50, Last-Event-ID, recipient isolation, bounded/cancellable SSE and list cursor/header.

- [x] Task 3: Refresh/logout audit producers; required audit in mutation transaction, optional failure logging, typed registry capabilities and no secret snapshots.

- [x] Task 4: Provider-specific username/database validation before generation; MySQL usernames max 32 ASCII characters, PostgreSQL max 63 ASCII bytes; native initializer/env parity.

- [x] Task 5: Transactional outbox, unique notification job, recipient/payload snapshot, SKIP LOCKED claim, fencing lease, renewal, retries, native worker commands and Compose services.

- [x] Task 6: Explicit batch/dry-run cleanup; expired/revoked families and terminal outbox >30 days; orphan grace 24 hours with reference recheck; audit deletion disabled (365-day default if enabled); no notification deletion.

- [x] Task 7: Optional official OpenTelemetry, traces and bounded metrics, request/trace correlation, no secrets/PII, collector-independent readiness and optional collector profile.

- [x] Task 8: Additive provider migrations, model/constraint/index/FK/contracts/generator/docs parity, Docker/Compose/env/native initializer/CLI snapshot integration and review handoff.

## Detailed contracts

Logout accepts `{ refreshToken }`, returns 204 even for an unknown token, and revokes the family even when the supplied token was consumed by rotation. Go and .NET gain the endpoint. Refresh/logout/replay lock the same family row; replay revokes the family and returns 401. Keep consumed token hashes while the family is active. Access JWTs remain valid up to their 15-minute expiry. Preserve native response field names. Existing family expiry is preserved at upgrade and becomes sliding on the next successful rotation; existing .NET absolute expiry is no longer a rotation cap.

SSE sequence is allocated by a recipient counter in the insertion transaction. Backfill other frameworks by createdAt/id; preserve FastAPI sequence. Drain ordered batches before polling; without cursor start with unread, with Last-Event-ID replay after that recipient-owned notification. Unknown/foreign cursor is 400 before headers. Heartbeat 15 seconds, poll 3 seconds, lifetime min(14 minutes, JWT expiry); stop on inactive account. Short DB sessions and transport backpressure. List remains an array, optional cursor with documented next-cursor header.

Audit producer capability is typed. Required writes are atomic; optional failures are logged; unsupported overrides fail startup. Unknown logout has no fabricated mutation. Never snapshot credentials, token/hash or file bytes.

Outbox creation and notification commit are atomic. Return PENDING for queued email, SENT after delivery, FAILED on exhaustion; SMTP disabled + sendEmail saves FAILED without a job. Defaults: concurrency 2, poll 3 seconds, lease 60 seconds renewed every 20 seconds, 5 attempts, retry delays 5/30/120/600 seconds. Keep snapshot recipient and payload; unique job per notification; fenced claim/completion; recover abandoned leases. Worker separate from HTTP, graceful shutdown, idle without DB/SMTP work until shutdown if SMTP disabled, Compose waits for migration. SMTP is at least once and may duplicate after a crash following remote acceptance.

Cleanup is an explicit operational command, never API startup. Batch 500, dry-run and concurrent-safe deletion; retain active-family tombstones and pending/leased jobs; recheck upload DB references after 24-hour grace. Audit deletion opt-in, notifications retained.

Telemetry is optional/off by default. Native official SDKs, existing Go/.NET instrumentation extended; HTTP/DB/storage/Redis/worker spans, HTTP/SSE/outbox/retry/cleanup metrics, bounded operation-ID labels and structured trace/request correlation. No request bodies, tokens, emails, credentials or parameterized SQL export. Collector failure cannot affect readiness. Preserve existing .NET transport configuration.

## Review gate

After Tasks 1-8 report **implementation complete, awaiting review, not tested** with diff, new env/commands, API examples, migration impact and outstanding checks. Do not commit/push/publish before review/testing. Development snapshots only, never claim a tested release.

## Task 9 — Tests (separate, LAST; all local and remote CI gates complete)

User authorized execution on 2026-10-02 and then requested collected failures, grouped repairs, fixture cleanup and commit/push after verification. Native/database, Windows/Linux development-tarball consumers and all ten expanded Compose combinations pass. Current evidence and boundaries: [verification report](BACKEND-HARDENING-TEST-RESULTS.md). All six repositories were committed and pushed; the final native and CLI CI runs pass. Versioning/npm publication remains a separate release action.

- [x] Auth sliding/expired/revoked sessions, consumed-token logout, refresh/logout races and replay.

- [x] Required rollback/optional audit failure and override validation.

- [x] SSE backlog 51/120, reconnect/foreign cursor, concurrent inserts, expiry, inactive user and slow clients.

- [x] CLI MySQL 32/33, PostgreSQL 63/64 before generation.

- [x] Atomic outbox, SMTP disabled/failure/recovery, retry exhaustion, restart/lease expiry/multiple workers, duplicate-delivery boundary.

- [x] Cleanup retention/dry-run/active sessions/audit opt-in/upload references/concurrent runs.

- [x] Telemetry off/on, unavailable collector, trace correlation and redaction.

- [x] Five native build/typecheck/lint/unit/integration/API contract gates.

- [x] Ten fresh/upgrade database gates and ten generated-tarball install/build gates.

- [x] Ten Compose image/migration/worker/seed/HTTP/live/ready/outage gates.

- [x] Dependency/lock/package/checksum/secret audits.
- [x] Windows/Linux and macOS smoke CI after local success.

Only start Task 9 after the user reviews all enhancements and explicitly requests tests. Commit, push, version bump and npm publication are subsequent user-directed release tasks.

## Implementation handoff

See [review and diff guide](BACKEND-HARDENING-REVIEW.md) and [separate final testing task](BACKEND-HARDENING-TEST-TASK.md). Checked implementation tasks describe source changes, not test results.
