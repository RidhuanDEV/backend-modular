# Laravel implementation and release evidence

Observed on 3 October 2026. Laravel source, build, native gates, both-provider runtime/Compose acceptance and final Windows installed-package consumers passed. Shared root release, full seven-framework matrix and root CI remain in progress with the Spring Boot implementation. The original user request explicitly authorizes tests, fixes and main pushes; npm publication/version changes remain unauthorized.

| Evidence | Result |
| --- | --- |
| Source release | `https://github.com/RidhuanDEV/modular-laravel.git`, final main `f5a1ada9d7c0c48eeb133e8cf0653b069457a101`; exact remote HEAD verified and source worktree clean |
| Observed source CI | [37101349709](https://github.com/RidhuanDEV/modular-laravel/actions/runs/37101349709): all three jobs PASS on final source HEAD: native Windows/Linux, full Docker build and PostgreSQL/MySQL integration. The preceding code correction also passed [37101082690](https://github.com/RidhuanDEV/modular-laravel/actions/runs/37101082690) |
| Full build/package | All six gates PASS: locked install, native autoload/discovery/registry/OpenAPI, app/web images, both Compose configurations (`laravel-build-OYm4ia`). Root CLI TypeScript build PASS |
| Native Windows | All seven gates PASS: platform/extensions, Composer strict/audit with no advisories, fresh Pint cache, Larastan max, 8 unit tests/335 assertions, native config/route cache (`laravel-native-logs-4qGmR9`). Exact official setup-php Windows wrapper executed Composer 2.9.8 through both source and CLI adapters; unknown wrapper rejection verified |
| Source integration | 17 tests per provider PASS (`laravel-integration-logs-mbBpqo`), including migrations/upgrades, refresh/audit/RBAC, atomic quota/counters, cleanup and worker lifecycle |
| Final source snapshot | `create-ridhuan-backend/templates/laravel/template-manifest.json`: 182 files, source commit `f5a1ada9d7c0c48eeb133e8cf0653b069457a101`, `dirty: false`, per-file SHA256 metadata. Private runtime artifacts excluded |
| Latest Windows installed-package PostgreSQL consumer | All 13 gates PASS (`laravel-consumer-logs-DS8Rje`): install/generate, locked Composer install, build/analysis, 8 unit tests before and after Invoice generation, selected-provider 17 integration tests, real native auth/RBAC/Invoice CRUD (`laravel-manual-logs-NuwUcM`) |
| Latest Windows installed-package MySQL consumer | All 13 gates PASS (`laravel-consumer-logs-v9Dgwu`), same scope; manual HTTP `laravel-manual-logs-aceHYz` |
| Latest consumer artifact | TEMP `laravel-final-source-consumers-df170ef3/create-ridhuan-backend-1.4.0.tgz`, SHA256 `d67ffdd5c65ea59293472b3fca54b227910d6e12d1241dc57e92bbd5ecfcd099`. Laravel provenance is clean; the shared archive still contains development snapshots for other sources and is not the final root release artifact |
| Linux installed-package consumers | Both providers PASS through shared collector `1791003182136`; final root Linux matrix must use its final immutable shared artifact |
| Complete Compose acceptance | PostgreSQL 14/14 PASS (`laravel-compose-logs-6Wx8yp`), MySQL 14/14 PASS (`laravel-compose-logs-xNAGrJ`): auth/binary/private paths/OpenAPI, 120 sequential mixed-status responses, SSE lifecycle/backlog/admission, two children with 23s SMTP and parent renewal, retry/TLS, two-replica Redis quota/cache/outages, scoped S3/HeadBucket/compensation, cleanup, official OTel/privacy/outage, database outage and verified owned cleanup |

The initial source CI identified two incorrectly indented return statements, a stale local Pint cache and the official setup-php Windows Composer wrapper. Corrections were made together after all CI jobs completed, then affected gates and the complete native stage passed. CI subsequently passed on the corrected code and final documentation commit. Native formatting uses a fresh cache inside each run's TEMP diagnostics directory.

Diagnostics live in OS TEMP outside source/npm payload. Every Docker fixture uses an owned name/project/label and finally cleanup; full Compose cleanup includes optional profiles and verifies containers, volumes, networks and owned image tags. Latest consumer database/manual fixtures also cleaned up successfully. No global prune or unrelated resource removal was performed.

The initial Windows log-name failure created no Docker resources. One original scratch directory (`ridhuan laravel compose-i0FmXk` in OS TEMP) remains because automatic approval review rejected its manual removal as blocked by policy. Subsequent fixtures completed their cleanup; the rejected removal was not bypassed.

Production deployment, capacity/load, real deployment TLS, HA and backup restoration remain unverified. SMTP remains at least once, and object-store compensation/reference checks are not a distributed SQL/object-store transaction. Complete the shared matrix, final source Git links/root artifact, main push and observed root CI before checking Laravel plan L9.
