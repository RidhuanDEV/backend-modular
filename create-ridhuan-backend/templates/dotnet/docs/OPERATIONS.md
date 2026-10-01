# Release and operations

## Release

Provision a separate database using the selected PostgreSQL or MySQL provider, and storage. Inject runtime secrets from environment/secret manager; .env is for local convenience. Back up the database and objects before schema changes. Run Migrator once as a controlled release job, then deploy API replicas; never start migrator/seed per replica. Compose enforces successful migration before app. Changing provider does not convert existing data; PostgreSQL and MySQL have separate migration histories. MySQL DDL can implicitly commit: inspect actual schema/history after a failed migration before attempting recovery.

Before rollback, inspect migration SQL and schema compatibility with previous API. Rolling application back cannot undo destructive schema changes. Use additive changes before removing columns; restore a verified backup when an incompatible data rollback is required. Do not automatically retry non-idempotent transaction failures; 409 asks the caller to retry deliberately.

## Network

Terminate TLS at a trusted reverse proxy. Configure known proxy IPs explicitly before honoring X-Forwarded-For; default ignores forwarded headers. Set Proxy__KnownProxies__0 (and further indexed IPs) with Proxy__ForwardLimit; an empty list disables forwarding. Never trust arbitrary Internet headers. Keep PostgreSQL/Redis/S3 administration private. Body cap must match `Upload__MaxBytes` plus multipart overhead at proxy and Kestrel. Production requires explicit CORS origins, no wildcard and no credentials by default.

Readiness is /ready; liveness is /live. A cache-only Redis outage is a cache miss and must not restart healthy replicas. A required limiter outage makes readiness fail; auth fails closed while public/internal remain available per policy.

## Endpoint policy configuration

`ENDPOINT_POLICIES_JSON` can override `audit`, `rateLimit`, and `cache` for a registered endpoint ID at process startup. For example, `{"user.get":{"audit":"optional","cache":"off"}}`. Unknown IDs, properties, and enum values fail startup. Required audit is unavailable on GET because the request pipeline does not provide a transactional producer for read endpoints. Required audit on mutations is inserted in the same PostgreSQL transaction as the mutation; optional audit is recorded after commit and may fail without undoing that committed mutation. Snapshot values are redacted before persistence. See the [endpoint registry](../src/ModularBackend.Api/Endpoints/EndpointRegistry.cs) for IDs and defaults.

## Observability

JSON console logs include request ID, HTTP status and duration without request bodies/tokens. Restrict log access and define retention in deployment. Optional OTLP configuration uses official OpenTelemetry packages; enable `Telemetry__Enabled`, Endpoint and ServiceName. Confirm the collector and instrumented span sources in staging rather than assuming exporter configuration proves delivery.

Alert on 5xx/503, limiter outage, audit optional failure, upload compensation/orphans, database pool saturation, latency and disk/storage capacity. Required audit failures roll back requests; investigate the audit database condition instead of disabling required auditing.

## Backup, restore and retention

Use pg_dump in custom format for the dedicated .NET database, preserve migration history and cache_generation, and back up upload objects consistently. Encrypt backups with access/retention policies. Restore PostgreSQL to an isolated database and objects to an isolated root/bucket, run migration compatibility checks, verify grants/user reads/file metadata and sample object checksums. Record RPO/RTO from an actual restore drill. Local smoke does not prove disaster recovery.

For MySQL, use MySQL 8.4 backup/restore tools such as mysqldump, preserve EF migration history and cache_generation, and restore to an isolated MySQL database with the same charset/collation. PostgreSQL restore tools cannot restore a MySQL dump. Use separate operational credentials with the required backup privileges; keep secrets outside command logs. Apply the same metadata/object consistency and application checks before accepting a recovery point.

Archive activity_logs according to the project's retention policy; keep historical actor snapshots and nullable user FK intact. Clean upload orphans with the tool dry run, review UUID candidates after grace period, then use --apply explicitly. Grace must exceed all upload/transaction durations; never delete newly written objects. Upload compensation checks database references before deleting after a commit failure; if the database outcome cannot be confirmed, retain the object and recover through the orphan tool after the grace period.

Staging load, shutdown/drain, rollback and restore exercises are required for a production deployment claim.
