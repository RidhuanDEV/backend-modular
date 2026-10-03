# CLI MinIO credential regression

The NestJS/PostgreSQL Compose job in [main run 37119927181](https://github.com/RidhuanDEV/backend-modular/actions/runs/37119927181/job/111194029736) failed during bucket initialization. `mc alias set` interpreted a randomly generated S3 secret beginning with `-` as an unsupported flag. The API itself started and returned readiness 200. The generic Compose exception was a consequence of the failed initializer.

The shared generator adds `--` before positional arguments in copied MinIO initializers, after selecting the database-specific Compose file. This covers Express, NestJS, Go, FastAPI, Spring Boot, and Laravel. Supplied secrets and random secret generation remain unchanged. Source repositories, snapshot checksums, database migrations, existing projects and local `.env` files are unchanged; existing generated projects require the same initializer correction manually.

The complete CLI build passed with no test execution before the regression stage. Version remains 1.4.0; no npm publication.

The complete collecting stage was authored before execution at `%TEMP%/cli-minio-regression-stage.mjs`; diagnostics are in `%TEMP%/cli-minio-regression-tVkPSe`. It checks all fourteen generated framework/database combinations, preservation of a fixed dash-prefixed S3 credential, runner failure collection, both complete NestJS Compose acceptance scenarios, Docker ownership isolation and task-owned cleanup in finally. Independent cases continue after failure, and any case or cleanup failure makes the aggregate fail.

Local regression: all five independent tasks passed. The fourteen generation combinations preserve the dash-prefixed secret; both complete NestJS PostgreSQL/MySQL Compose scenarios passed, as did the four runner tests and four Docker isolation tests. Finally cleanup verified both project owners absent, preserving unrelated Docker resources. Tested local archive SHA256: `c31aa348879310d62fd88a746c35f6089aab8f008325e443ce8e943a3811bc54`. This receipt predates a separate uncommitted README rewrite and is not a receipt for the final hosted archive.

The workflow adds `verification=nestjs-compose` for the affected package and two database jobs before full validation. Main pushes continue to run the complete matrix. Commit, push and corrected hosted CI verification pending. Previous Spring/Laravel release checklists remain pending and are not completed by this targeted fix.
