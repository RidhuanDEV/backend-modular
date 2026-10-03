# Spring Boot and shared CLI verification

Updated 2026-10-03. Implementation, full builds and final local gates PASS. Source repositories are pushed to main with observed passing CI. The root main push and complete hosted matrix remain pending; no npm version bump or publication was performed.

## Source and provenance

| Repository | Verified remote main | Observed CI |
| --- | --- | --- |
| [Spring Boot](https://github.com/RidhuanDEV/modular-springboot) | `15c991e096c73161dcebba418d2034de205208d7` | [37107233465](https://github.com/RidhuanDEV/modular-springboot/actions/runs/37107233465), Windows/Linux2/2 PASS |
| [Express](https://github.com/RidhuanDEV/modular-express-typescript-starter-postgre) | `aa148779cf4c5e19de46d2e812c4af151c6b9cc1` | [37106757439](https://github.com/RidhuanDEV/modular-express-typescript-starter-postgre/actions/runs/37106757439), PostgreSQL/MySQL2/2 PASS |
| [Laravel](https://github.com/RidhuanDEV/modular-laravel) | `f5a1ada9d7c0c48eeb133e8cf0653b069457a101` | [37101349709](https://github.com/RidhuanDEV/modular-laravel/actions/runs/37101349709),3/3 PASS; separate [Laravel receipt](LARAVEL-PHP-VERIFICATION.md) |

Root baseline is `b913b0ee4ecb6b57e5c2c17fcfd9bf0d3bb14ce5`. Other source heads are preserved: NestJS `fa179269ba8b4fd37d60487913d2f98a9ae7b2ca`, Go `dadd6dc8972b9c07ce9ebbc5f8571f8668276441`, .NET `afef88a6fe5c75fb0f9307f8cabca682787b50fe`, FastAPI `2de7aad9ca64ac3eedfb719687278a5889d69f6a`.

Clean manifests identify these actual source commits with `dirty:false`; payload counts are Spring146, Laravel182, Express129, NestJS115, Go166, .NET140 and FastAPI103. The immutable source-CI artifact is `spring-source-ci-artifact-794a31d3d5a54f158524249366733989/create-ridhuan-backend-1.4.0.tgz` under OS TEMP, SHA1 `5d44bea722610e5b3100b1ddc1848039675c0764`,1012 archive entries. Runtime code is identical to the locally verified EOF artifact; subsequent source changes are CI quoting and verification documentation.

## Completed gates

| Gate | Actual result; receipts under OS TEMP |
| --- | --- |
| Full builds, tests disabled | Java clean package/NullAway/raw generics, CLI, affected Express and native Java Docker image PASS. EOF build `spring-eof-full-build-fd2485bde8f84d79b9dbbc1b47fb96c9.log`; Docker `spring-eof-docker-build-spring-e3dd8cb2d2434097a01acaecb5f1002d.log` |
| Native Java | Seven gates/17 tests PASS: Core7, StorageScope2, StreamConnection4, Schema2, Systems2 plus formatter/dependency tree; `springboot-verification-3769c7c3f4da4be4920f5d767a69d17b` |
| Both-provider manual API |19/19 per provider,38 total PASS; `springboot-final-stage-AejccH` (PostgreSQL `P0eeOW`, MySQL `keh9qg`) |
| Both-provider Compose |18/18 per provider,36 total PASS; `springboot-final-stage-ihQDYq` (PostgreSQL `uXnUx1`, MySQL `AMW4hz`) |
| Controlled SSE comparison | Five unchanged admission/cancel/recovery cases PASS; `sse-mini-stage-XjWnVW` |
| Affected cancellation/slow-client | Both cases per provider PASS; `springboot-final-stage-dxIBdc` |
| Installed Windows/Linux consumers | Both providers PASS with renamed package, real native build, generated38-operation Invoice module, overwrite/keyword rejection,13 pure unit cases and invalid JAVA_HOME rejection before folder creation; Windows `springboot-final-stage-l24l2X`, Linux `ridhuan-hardening-suite-1791013200949` against the clean release artifact with explicit Docker absence checks |
| Package/runner/selection/history | All14 generated combinations, checksums/secret exclusion, npm exec/create, invalid input, collecting exit codes and historical migration preservation PASS; `springboot-final-stage-RPMBNy` against the clean source-CI artifact (earlier `DFw1p5`, clean release `xaaRHk`). Five invalid runtime-selection assertions PASS; Docker ownership-isolation runner4/4 PASS |
| Shared framework regressions | Express native12/12 and Windows/Linux consumers PASS; latest Express and .NET both-provider Compose4/4 PASS `ridhuan-hardening-suite-1791005388865`; NestJS, Go, FastAPI and Laravel both-provider Compose PASS |
| Dependency/lock/license audits | Shared eight gates PASS `ridhuan-hardening-suite-1791004637435`; Java OSV0 and license resolution PASS `spring-dependency-audit-5341f040360846068971d33459221260`. Go reachable vulnerabilities0; one unreachable module advisory remains explicitly reported |

The74 complete runtime cases cover native migrations/upgrade/failure gating, generator HTTP CRUD, registry/OpenAPI/DTO/RBAC, refresh-family sliding/replay/concurrency, required/optional audit, SSE120/backlog/cursors/ownership/expiry/inactivity/cancel/slow writes, local/S3 compensation, two-worker fencing/retry/real23s renewal/graceful drainage, cleanup, two-replica Redis quota/cache/outages, telemetry/privacy/collector outage, SMTP TLS/hostname validation, and database outage live/ready/EOF.

## Failures, corrections and cleanup

The original PostgreSQL Compose stage15/18 PASS exposed SSE cancellation and a dependent slow-client failure, plus an expired startup-login quota fixture. Controlled same-Node24.19.0 comparisons isolated Windows-to-Docker half-close: native sockets stayed CLOSE_WAIT, Servlet async stayed active and all16 tasks survived while input EOF was pending. The initial Servlet-state candidate was withdrawn. Exact native connection-ID binding plus the published Tomcat nonblocking readiness/EOF API on the existing3s loop now passes the original assertions. Buffered input is preserved; input must remain open during a bodyless HTTP/1.1 SSE session.

The first correction comparison4/5 PASS remains recorded with one Linux header-stage ECONNRESET; its focused rerun and complete five-case rerun PASS. MySQL fixture DDL/trigger owner permissions, SMTP lease observation timing, quota window/bootstrap accounting and scoped S3 key assertions were corrected after complete collected stages. Incorrect scenario selection is rejected before allocating fixtures. The stale Express documentation manifest failure was resolved by rebuilding all snapshots. Source CI first failed on the same unquoted PowerShell Maven property in both OS; its affected build and complete corrected CI PASS.

Every Docker fixture uses its own project/name/label and finally cleanup with absence verification. Interrupted superseded and incorrectly selected stages remain FAILED/ABORTED, with their owned resources removed and verified. No global prune was used. Three unrelated pre-existing user containers remain preserved. All seven snapshot manifests have zero missing tracked files; the root ignore pattern is anchored to `/backend/` so Java package sources are included. Diagnostic logs/certificates/project scratch files stay outside source/npm payload; local `.env`, data and existing migration histories are preserved.

## Remaining release verification

Root clean artifact checks PASS (four collecting gates `springboot-final-stage-RPMBNy`); final main commit/push and the complete hosted matrix (28 Windows/Linux consumers,14 Compose jobs, macOS smoke) are not yet complete. Record the actual root remote HEAD and all CI conclusions before checking plan S12 and Laravel L9. Publishing remains a separate instruction.

These gates do not establish production ingress/TLS/HTTP2 behavior, load capacity, HA/failover, real external email delivery or backup restoration. SMTP delivery remains at least once; SQL/object-store compensation is not a distributed transaction.
