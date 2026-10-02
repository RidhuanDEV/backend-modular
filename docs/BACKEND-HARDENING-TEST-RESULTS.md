# Task 9 — Current verification evidence

Status: **local Task 9 verification complete; commit/push and remote CI verification next**, authorized on 2026-10-02. The local evidence below concerns this implementation and development tarballs; earlier release results are not used as evidence.

## Native and Windows consumer gates

| Framework | Native gates | PostgreSQL tarball install/build/manual runtime | MySQL tarball install/build/manual runtime |
| --- | --- | --- | --- |
| Express | Build, ESLint, 18 service-free tests pass (16 existing + 2 focused hardening tests) | PASS | PASS |
| NestJS | Build, strict typecheck, Prisma validation, registry contract, 12 service-free tests pass | PASS | PASS |
| Go | `go test ./...`, `go vet ./...` pass; native PostgreSQL HTTP/database and MySQL port/upgrade suites pass with isolated fixtures | PASS | PASS |
| .NET | Release solution build, locked restore, 14 unit + 3 contract tests pass; 16 integration tests pass on each provider | PASS including latest SSE source repair build/unit/contracts | PASS including latest SSE source repair build/unit/contracts |
| FastAPI | Locked sync, Ruff lint/format, strict Pyright, 11 unit tests, OpenAPI pass; two integration tests pass on each provider | PASS | PASS |

Consumer fixtures also exercise generated modules on Express, NestJS and FastAPI. Windows manual fixtures create disposable database containers, apply migrations, seed explicitly, launch the API through its env loader, and check `/live`, `/ready`, docs, login and the selected port.

CLI tests pass ten framework/provider generations, `npm exec` and `npm create` against a locally installed development tarball, default ports, nonempty/symlink target rejection, dependency failure recovery, and identifier boundaries (MySQL user 32/database 64; PostgreSQL user/database 63). This is **development tarball evidence**, not a newly published npm release.

## Runtime matrix (latest expanded suite)

| Framework/provider | Fresh/legacy upgrade | Auth/audit/SSE | Worker/retention | Telemetry | Compose/outage |
| --- | --- | --- | --- | --- | --- |
| Express/PostgreSQL | PASS | PASS including paused TCP client, short JWT expiry and DB-outage stream completion | PASS including lease renewal, graceful stop, atomic outbox audit rollback, upload reference/grace/concurrent cleaners and audit opt-in | PASS | PASS latest expanded suite |
| Express/MySQL | PASS | PASS including paused TCP client, short JWT expiry and DB-outage stream completion | PASS including renewal, graceful stop, atomic audit rollback, upload reference/grace/concurrent cleaners and audit opt-in | PASS | PASS latest expanded suite |
| NestJS/PostgreSQL | PASS | PASS including ordered backlog, slow client, expiry and inactive recipient | PASS including retries, renewal/fencing/recovery, atomic outbox and concurrent cleanup | PASS | PASS latest expanded suite including DB-outage stream completion |
| NestJS/MySQL | PASS | PASS including ordered backlog, slow client, expiry and inactive recipient | PASS including retries, renewal/fencing/recovery, atomic outbox and concurrent cleanup | PASS | PASS latest expanded suite including DB-outage stream completion |
| Go/PostgreSQL | PASS | PASS including backlog/reconnect/expiry/inactive | PASS including retries, renewal/fencing/recovery and concurrent cleanup | PASS including HTTP OTLP paths | PASS latest expanded suite including DB-outage final SSE chunk |
| Go/MySQL | PASS | PASS including ordered backlog/reconnect/expiry/inactive | PASS including renewal/fencing/recovery, snapshots/retry/cleanup | PASS | PASS including final DB-outage SSE completion |
| .NET/PostgreSQL | PASS | PASS including three real Redis latency/recovery cycles, family-lock concurrency and ordered SSE | PASS including retries, lease renewal/recovery, immutable payload and concurrent cleanup | PASS including gRPC and HTTP/protobuf, log correlation/redaction and Collector outage | PASS full repaired suite including clean DB-outage SSE completion |
| .NET/MySQL | PASS | PASS including three Redis latency/recovery cycles, family-lock concurrency, cursor isolation and ordered SSE | PASS including retries, renewable/fenced leases, immutable email snapshot and concurrent cleanup | PASS including gRPC and HTTP/protobuf, safe log correlation/redaction and Collector outage | PASS full repaired suite including clean DB-outage SSE completion |
| FastAPI/PostgreSQL | PASS | PASS including expiry/inactive/DB-outage clean SSE completion | PASS including atomic outbox, lease renewal/fencing/recovery, retry exhaustion, cleanup/grace/audit opt-in | PASS | PASS latest expanded suite |
| FastAPI/MySQL | PASS | PASS including expiry/inactive/DB-outage clean SSE completion | PASS including atomic outbox, lease renewal/fencing/recovery, retry exhaustion, cleanup/grace/audit opt-in | PASS | PASS latest expanded suite |

The reusable suites live in `create-ridhuan-backend/scripts/verify-hardening.mjs`, `verify-hardening-upgrade.mjs`, `verify-worker-retention.mjs`, and `verify-compose.mjs`. They use real SQL provider locks, controlled family-lock overlap, audit insertion fault triggers, SMTP failure/hold modes and explicit lease expiry/fencing. MySQL triggers are installed by the **disposable database administrator**; application privileges are not elevated.

## Repairs found by these gates

- NestJS Prisma generated constructor requires explicit query-log options as its first generic argument. The SSE integration test now uses the HTTP transport and cancellation rather than the removed RxJS controller contract.
- Go/NestJS env fixtures now supply valid database usernames; missing logout body is correctly tested as 400.
- New Prisma MySQL tables now use the historical `utf8mb4_bin` collation so strict family/user/notification FKs can be created. Old migrations remain unchanged.
- Express idempotent logout explicitly reports no mutation when the hash/family is unknown or already revoked. Required audit no longer turns this valid 204 into 500; no false mutation record is produced.
- Express readiness logs only the error type, excluding provider error payloads.
- FastAPI strict annotations use nonnullable local lease IDs and Generator/AsyncGenerator context manager contracts; imports are formatted.
- Go module graph is tidied after removing unused automatic HTTP instrumentation.
- SMTP consumer tests now require `201 PENDING` and wait for the separate worker to persist `SENT`.
- .NET migrator supports an explicit known `--to-migration` target for upgrade fixtures; ordinary release invocation still migrates to latest.

Additional Task 9 fixes: .NET notification recipient locking explicitly selects PostgreSQL `xmin` required by EF row-version mapping; both provider integration suites pass after repair. NestJS S3/Redis tests respect isolated service addresses and Redis uses a unique namespace. Go legacy tests target migration 5 and read SSE UUID ID plus event fields. Compose fixtures decode generated dotenv quoting and isolate configuration from inherited test env. Source configuration regressions cover the independent username/database limits on all frameworks.

Later runtime fixes, now verified:

- FastAPI's SSE deadline cancellation now emits the final ASGI response body after the generator unwinds. Previously Uvicorn reported an incomplete response and consumers received a broken chunked stream at JWT expiry. A focused middleware regression passes. Expected database stream failure ends the generator with a safe log message.
- FastAPI provider-limit unit fixtures isolate their working directory from the generated provider marker; both providers are still validated, without changing the production marker check.
- Go SMTP now uses the worker's 25-second delivery budget, allowing its 20-second lease renewal. The former 10-second nested deadline prevented renewal during a long delivery.
- Go's generic OTLP endpoint explicitly appends the trace and metric paths, including a configured base prefix. The installed exporter API otherwise targets `/` for a bare endpoint URL. An HTTP collector regression verifies both signal paths.
- .NET API, worker and cleanup use structured JSON logging with raw hosting URL/query and EF command/update/query categories disabled. A private query sentinel exposed the initial problem; both provider runtime redaction suites now pass.
- FastAPI SMTP uses the same 25-second delivery budget as the worker, so a 20-second lease renewal can happen during delivery. Both provider Compose worker suites pass.
- .NET HTTP/protobuf exporters now append `/v1/traces` and `/v1/metrics` to the configured base endpoint and keep gRPC unchanged. Three native option-contract regressions pass.
- .NET rate limiter/cache explicitly handle `RedisTimeoutException`, which is not a subclass of `RedisException`. Both provider suites pass three real Redis latency/recovery cycles.
- Go gives its HTTP server a bounded final-chunk write deadline when SSE closes after a database outage. Native gates and both full provider runtime suites pass.
- The worker fixture deadline covers the application SMTP budget and includes worker/SMTP diagnostic logs. Both .NET snapshot-delivery/renewal scenarios pass.

## Dependency evidence

- CLI/Express/NestJS npm audit: zero advisories reported.
- .NET: locked restore succeeds; NuGet vulnerability query reports no vulnerable packages in all twelve projects.
- FastAPI: pip-audit reports no known vulnerabilities (editable application distribution skipped).
- Go govulncheck: zero reachable symbols/imported packages affected. One module-only advisory, `GO-2026-5932`, concerns unmaintained `golang.org/x/crypto/openpgp` (not imported/called here, no fixed version). This is not represented as a zero-advisory module graph.

## Follow-up collection on 2026-10-02

- The first resumed collecting stage finished all eleven selected cases: four passed and seven failed. Independent cases continued after each failure, with a nonzero aggregate result. The failures below were repaired together and affected reruns passed; earlier failures are retained as history.
- NestJS SMTP fixtures used an expired cached certificate. Every fixture now forces fresh certificate generation and checks its validity before connecting; TLS verification remains enabled.
- A concurrent audit cleanup interrupted the Go/PostgreSQL fixture. Cleanup now scopes ownership to each runner's logs; a Docker regression verifies that another active fixture's container and volume survive. Go/MySQL subsequently passed its full expanded Compose suite.
- Both Linux .NET consumer cases correctly rejected a missing Python env loader dependency. The slim verification image now installs Python before generation; both affected final consumer reruns pass.
- .NET/MySQL initially failed trace propagation. Official ASP.NET Core and HTTP client instrumentation is now registered, with sensitive tags filtered. Fourteen native unit tests and both provider runtime telemetry suites pass, including incoming HTTP trace propagation and query/header exclusion.
- The PostgreSQL .NET Redis-latency scenario initially returned 500. Static error-origin labels avoid exporting exception messages, SQL parameters and credentials. After an SDK image registry interruption was resolved, the diagnostic scenario passed latency, auth/audit, ordered SSE and uploads; the full final suite requires three latency/recovery repetitions on each provider. No blanket `InvalidOperationException` fallback was introduced. The diagnostic SMTP certificate extraction command also had a misplaced argument, which was corrected before the grouped rerun.
- The separately collected fresh dependency/lock audit stage passed all checks. Its result is stored under `TEMP/hardening-audit-final-20261002`.
- The repaired .NET/PostgreSQL runtime exposed an SSE database-outage bug: a provider exception after headers had started reached error middleware and aborted the HTTP response. MySQL confirmed the same issue. The controller now logs a safe error type and closes the stream cleanly for recognized provider exceptions (including EF wrappers). Unexpected programming errors remain visible. Both full provider reruns, fourteen unit tests, and final Windows/Linux generated consumers pass.

## Final local gates and evidence location

- Native database suites pass for all frameworks on both providers. All ten complete expanded Compose combinations now pass; partial or interrupted runs were not promoted to full passes.
- Ten Windows and ten Linux development-tarball consumer combinations pass. The final .NET source repair is covered again on both operating systems/providers (fourteen unit and three contract tests each). Windows manual HTTP consumer checks also passed for all ten combinations before the targeted final repairs; final repaired HTTP behavior is covered by Compose.
- Both sqlc provider ports reproduce their hashes; .NET format verification passes and model consistency is exercised by native provider integration. All 31 tracked historical migration files (including EF designers) remain byte-equivalent after newline normalization. Archive allowlist, 653 native source snapshot checksums, private-key exclusion and four local env credential exclusion checks pass for the current development archive. The archive contains 679 files. Repeat the checksum check if repacked.
- Remote Windows/Linux CI and macOS smoke will be checked after the authorized commit/push. npm publication is a separate action.

Local detailed logs are in TEMP and are not public package contents. Final collecting reports are `hardening-repaired-matrix-20261002` (NestJS/Go and Linux fixes), `hardening-dotnet-sse-runtime-20261002` (5/5 final .NET Compose/Linux cases), `hardening-dotnet-sse-host-20261002` (2/2 final Windows cases), `hardening-audit-final-20261002` and `hardening-distribution-final-20261002`. Each saves its plan before execution and its per-case results afterwards. Fixtures remove only their owned resources; unrelated local services are preserved.

## Historical local infrastructure interruption (resolved)

Docker Desktop initially stopped during image/consumer verification when D: had only 17 MB free. Reproducible .NET bin outputs were preserved in the task-specific TEMP backup on C: to recover approximately 1.8 GB; source and env files were unchanged. After user disk/RAM recovery, all interrupted cases were rerun successfully and sequentially. The final stages maintained more than 3 GB free on D:. No global volume/system prune was used.

## Verified local archive identity

The runtime-tested development archive has SHA-256 `be13c691efa0c51fe1d7586c6a74763a4208dfd78e7a1eb0c0cc65f748a5b399`. After the five native source commits, a clean-provenance CLI candidate was packed with SHA-256 `80dda0c296fa826403a4ef7cc7769d5fc3a8f4e47a33b1a03fff4bc5f047aec1`. Its source commits match the published Git repositories; the intervening differences are documentation and provenance. Version remains `1.4.0`; this candidate has not been published to npm. The earlier inspected archive `5b086006ff2edf5702bef200b73e93a9275c2a08ff6ed37d3568f88529694e59` is historical evidence only.

## Verification boundaries

- All ten final expanded Compose combinations pass on the locally available Linux Docker engine. This is not production deployment/load/restore evidence.
- The paused TCP client scenario checks cancellation and API responsiveness, not indefinite saturation of every operating-system socket buffer.
- Runtime upload cleanup checks old referenced objects, the 24-hour grace period, dry-run and concurrent cleaners. An insert precisely between the two reference lookups is not controlled in this suite; the final reference lookup is source-verified.
- Session-age fixtures make the family creation date older than 120 days and exercise rotation against server UTC. They do not wait 120 wall-clock days. Retry timestamps and abandoned leases are advanced in the disposable database rather than waiting 600 seconds or 30 days.
- Remote GitHub Windows/Linux/macOS jobs are being checked following the authorized source push. Production load, deployment and backup restore are outside this evidence.
- Local .NET build binaries were preserved under `%TEMP%/ridhuan-hardening-build-backup-20261002` on C:. Rebuilding recreates them; source, migrations, lockfiles and env files were not removed.

## Historical resume order after disk/Docker recovery

Run Compose sequentially: Go PostgreSQL/MySQL, NestJS PostgreSQL/MySQL, .NET PostgreSQL/MySQL. Use the inspected development tarball via `CLI_TARBALL`, and retain diagnostic projects with `--keep`. Then repeat final .NET Linux consumers for both providers. Remove only the explicitly retained, task-owned Compose projects from interrupted runs; never use global volume/system prune. The final .NET Compose suite includes real `CLIENT PAUSE` latency for auth fail-closed and optional-cache/internal fail-open behavior.

## Resumed execution

Docker responds again. Full scripts are authored before execution; the collecting runner logs independent failures and has no automatic retry loop. Initial fixture cleanup removed nine task-owned containers, four volumes, two networks and five image tags. The first resumed migration/archive and CLI contract checks pass. `hardening-resume-20261002/plan.json` and `results.json` in TEMP record the remaining cases.

## Collected failure group and repair

The resumed NestJS SMTP assertions found a shared fixture certificate cached from September 30 that expired October 2 at 09:57 UTC. A direct TLS handshake reported CERT_HAS_EXPIRED. The SMTP Docker build now uses a unique per-case certificate nonce and checks validity; TLS verification remains enabled. Both complete NestJS reruns pass. A concurrent audit cleanup initially interrupted Go/PostgreSQL; cleanup now uses only the caller suite log directory and skips non-Docker stages. Two runner regressions pass, including preservation of another active container/volume. Both complete Go provider suites pass after these repairs.
