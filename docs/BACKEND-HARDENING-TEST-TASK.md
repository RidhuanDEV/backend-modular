# Task 9 — Regression and distribution verification

**Local Task 9 gates completed on 2026-10-02; six repositories committed/pushed; all final CI gates passed on 2026-10-03.** Current native/database, consumer, concurrency and ten Compose results are recorded in the verification report. No prior release result is evidence for this implementation.

## Execution order

1. Native build/typecheck/lint and source-contract checks, with generated clients/ports up to date. Repair compilation and contract drift before integration.

2. Isolated PostgreSQL/MySQL empty-schema and upgrade fixtures for all five frameworks. Do not use application databases or existing local services. Preserve old migration checksums.

3. Regression/concurrency suite with controlled barriers and fault injection; then worker/cleanup/telemetry scenarios.

4. Development CLI tarball: ten generated project combinations, install and build from the packaged bytes, not source checkouts.

5. Ten Compose combinations: build images, one-shot migrations, separate worker, explicit seed, root/live/ready and failure/recovery probes. Tear down only the isolated verification projects/volumes.

6. Windows/Linux consumer verification; macOS smoke in CI after local gates pass. Dependency, lockfile, tarball allowlist, snapshot checksum and secret audit.

7. Record evidence, commands, revision, provider/runtime versions and remaining boundaries. The user has now authorized commit/push after verification completes; version bumps and npm publication remain separate instructions.

## Matrix

Every database-sensitive case below runs on Express, NestJS, Go, .NET and FastAPI, with PostgreSQL and MySQL. Use server UTC timestamps and a controllable clock where native ports allow it.

| ID       | Fixture / action                                                            | Required outcome                                                                                                                                     |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01  | Login, advance time, rotate repeatedly beyond 90 days                       | Access TTL 900s; family expiry equals each successful rotation +30d; no absolute cap                                                                 |
| AUTH-02  | Expired token/family, revoked family                                        | 401; no replacement and no family revival                                                                                                            |
| AUTH-03  | Logout with active, consumed pre-rotation and unknown token                 | 204 without body; known family revoked; unknown creates no mutation audit                                                                            |
| AUTH-04  | Barrier after initial lookup; run two refreshes                             | One may issue a pair; second replay revokes family; neither replacement can refresh afterward                                                        |
| AUTH-05  | Barrier before family lock; concurrent refresh/logout in both orderings     | Same family lock serializes; final family revoked, no revived session                                                                                |
| AUTH-06  | Consumed token whose token expiry has passed while family remains active    | Replay detected from retained hash, family revoked                                                                                                   |
| AUTH-07  | Upgrade active session, expired session, all-revoked family, old .NET cap   | Active expiry preserved until next rotation; invalid sessions stay invalid; old cap no longer limits rotation                                        |
| AUDIT-01 | Fail required audit insert during refresh/logout/create                     | Transaction rollback for token/family/notification/outbox                                                                                            |
| AUDIT-02 | Fail optional audit insert                                                  | Mutation commits; safe failure log; no token/password/hash in snapshots                                                                              |
| AUDIT-03 | Unsupported capability override; required GET                               | Startup rejects; supported auth producer overrides accepted                                                                                          |
| SSE-01   | Insert 51 then 120 unread rows; connect without cursor                      | Every row delivered once in order; all backlog drained before polling                                                                                |
| SSE-02   | Reconnect after UUID cursor; cursor row already read                        | All later sequences delivered, including read rows                                                                                                   |
| SSE-03   | Unknown and foreign recipient UUID                                          | 400 before `text/event-stream` headers                                                                                                               |
| SSE-04   | Two concurrent creators for one recipient, equal timestamps                 | Counter serialization yields unique increasing sequence; no MAX-based race                                                                           |
| SSE-05   | Another recipient, inactive account, expired JWT                            | Recipient isolation; stream closes on inactive/expiry, maximum 14m                                                                                   |
| SSE-06   | Blocked/slow client, disconnect during batch and DB outage                  | Bounded/cancellable writes, no long DB transaction; clean connection metric decrement                                                                |
| SSE-07   | List cursor pages during inserts                                            | Existing array envelope retained; ordered pages and `X-Next-Cursor`; absent on final page                                                            |
| CLI-01   | MySQL username 32/33 ASCII chars                                            | 32 accepted, 33 rejected before folder creation/install; provider+limit error without secret                                                         |
| CLI-02   | PostgreSQL username 63/64 ASCII chars                                       | 63 accepted, 64 rejected; same wizard/argument/env/native boundaries                                                                                 |
| CLI-03   | Database name MySQL64/65, PostgreSQL63/64                                   | Independent name limits; malformed identifiers rejected                                                                                              |
| OUT-01   | Create notification/sendEmail; fail before transaction commit               | Notification and job both commit or both roll back; 201 PENDING only for durable enqueue                                                             |
| OUT-02   | SMTP disabled/sendEmail true                                                | Stored notification FAILED; no job; worker stays idle without DB/SMTP connection, exits cleanly on SIGINT/SIGTERM, and does not break Compose --wait |
| OUT-03   | SMTP failure then recovery, 5 total failures                                | Retry delays 5/30/120/600; SENT on recovery, FAILED at max5                                                                                          |
| OUT-04   | Two worker processes, concurrency2, expired lease, fencing loss             | SKIP LOCKED prevents simultaneous ownership; stale owner cannot finish/update notification                                                           |
| OUT-05   | Kill after claim, during send, after SMTP acceptance before completion      | Recover lease; test and document possible duplicate; no sixth attempt after final abandoned attempt                                                  |
| OUT-06   | Change user email/title after enqueue; graceful shutdown                    | Snapshot destination/payload retained; stop claiming and finish bounded in-flight work                                                               |
| CLEAN-01 | Dry-run, retention boundary, active-family consumed hashes                  | No deletion in dry-run; active families/tombstones protected                                                                                         |
| CLEAN-02 | Terminal old outbox vs pending/processing                                   | Only terminal jobs beyond retention deleted                                                                                                          |
| CLEAN-03 | Audit default disabled; enable without explicit days                        | Logs preserved by default; invalid opt-in rejected; configured retention respected                                                                   |
| CLEAN-04 | Orphan <24h, referenced object, fresh reference before delete, two cleaners | Protected objects retained, reference rechecked, local not-found idempotent; batch bounded                                                           |
| CLEAN-05 | Stored notification after cleanup                                           | Notification retained                                                                                                                                |
| OTEL-01  | SDK disabled/enabled, collector missing                                     | App/readiness unaffected by exporter; required DB/rate-store still governs readiness                                                                 |
| OTEL-02  | HTTP/DB/storage/Redis/worker operations                                     | Trace linkage, bounded operation labels, HTTP/SSE/outbox/retry/cleanup metrics                                                                       |
| OTEL-03  | Credentials/token/email/body/SQL-param sentinel input                       | Sentinel absent from exported trace/metric and structured operational logs                                                                           |
| OTEL-04  | .NET grpc and http/protobuf; all Collector profiles                         | Native transport options supported, ports configurable                                                                                               |

## Upgrade fixtures

Start from the last committed schema, insert active/expired/rotated/logged-out refresh families and notifications with tied timestamps, then apply only new migrations. Assert family FK/expiry/revocation, preserved ID and token hashes, deterministic recipient sequence and counter, FastAPI sequence preservation, unique job-per-notification FK/index, and old PENDING→FAILED without fabricated jobs. PostgreSQL and MySQL migration tracking must report no changed historical migration.

## Evidence report

- [x] Native gates: five frameworks; changed source and generated artifacts.

- [x] Database gates: ten fresh and ten upgrade fixtures.

- [x] Regression matrix: explicit pass/fail per framework/provider, no checked box without execution evidence.

- [x] CLI: development tarball generation→install→build for ten combinations; final clean-source candidate verified after native commits.

- [x] Compose: ten isolated image/migration/worker/seed/HTTP/live/ready/outage combinations.

- [x] Windows/Linux local consumer install/build/native checks.
- [x] Remote Windows/Linux consumer CI and macOS smoke after commit/push.

- [x] Lock/dependency/package/checksum/secret audit.

Passing build, health, or source inspection alone is not concurrency, email delivery, restore, load, or production verification.

## Implementation-generated artifacts to review before tests

Prisma clients, sqlc ports/decorators, native Alembic/Goose migrations and EF migration/model snapshots are source preparation. EF scaffolding compiled Infrastructure as a tool prerequisite. Source formatting was applied; current native/database/consumer results and completed runtime/CI gates are recorded in BACKEND-HARDENING-TEST-RESULTS.md. Runtime checks used development snapshots; the final package check uses clean native commit provenance. npm version bump and publication remain separate release actions. Legacy assertion counts, auth fixtures and initializer input scripts may need updates against the actual new source contracts during this task; never adjust them solely to silence a failing test.

## Collecting runner (2026-10-02 user direction)

All cases are authored before execution in `create-ridhuan-backend/scripts/run-hardening-suite.mjs`. The runner saves the full inventory and selected cases to `plan.json`, then executes serially with separate logs and `results.json`. A failing child unit/build process is collected, not promoted to success and not an unhandled crash of the parent. An API assertion stops that scenario because later assertions would depend on invalid state; the next independent framework/provider case still runs. No automatic retry or repair loop is implemented. Review the full failure list, fix related causes together, then rerun only the affected cases with `--only`.

```powershell
$env:CLI_TARBALL = "$env:TEMP/create-ridhuan-backend-1.4.0.tgz"
npm run test:hardening:plan -- --stage all
npm run test:hardening -- --stage remaining
# Pick stages: native, distribution, compose, audit, all, remaining.
# Select already-authored case IDs with --only id1,id2.
npm run test:hardening:cleanup
```

Compose always removes its volumes, orphan containers and owned local image tags in finally. Additional cleanup identifies old fixtures only from task logs or a validated temporary fixture working-directory label. Shared application/production volumes and images are excluded. Linux consumer containers use --rm and the suite removes its consumer image tag. Logs/reports live in TEMP, outside public snapshots. Unit failures and cleanup failures produce a nonzero final suite result after independent cases have been collected; exit status must never be swallowed to make CI green.

Runner regressions in `scripts/test-hardening-runner.mjs` verify collected child failures and Docker cleanup isolation. SDK/dependency/lock auditing is scripted in `scripts/verify-hardening-dependencies.mjs`, with per-tool findings and a final aggregate exit status. Every stage has a plan before it executes. Do not run the legacy cleanup discovery command during another active fixture stage; the collecting runner uses its own log directory only.
