# Operations

## Release

1. Back up the selected database and test restoration outside production.
2. Run `backend migrate` once as a release job with an account permitted to change schema.
3. Start the new API replicas only after migration succeeds. Use `/live` for liveness and `/ready` for readiness.
4. Run `backend seed` only when explicitly provisioning bootstrap roles/account. Existing passwords are preserved.

Migrations are not executed during API startup. Multiple API replicas require a shared Redis limiter; persisted notification polling works across replicas independently of Redis. Keep JWT issuer/audience/secrets and provider selection consistent.

## Database settings

Use independent databases for each generated project. Set the provider during generation, then retain it in `backend-template.json`. Changing provider later requires a separately reviewed data/schema migration.

PostgreSQL pool: ten connections, five overflow; connection/acquisition timeouts are three seconds. MySQL uses the equivalent async pool with UTC session initialization. Instants returned by DTOs are aware UTC, and display zones are IANA conversions. Size pool limits against replica count and database capacity.

Configure certificate-verified TLS for remote databases and SMTP. Local Compose is a development fixture. Avoid broad proxy trust; default Uvicorn startup disables forwarded headers. If deploying behind a proxy, configure trust explicitly for the known proxy and verify limiter client identification.

## Failure and rollback

Required audit failure rolls back the business operation. Optional audit failure is logged. Redis cache failures use database reads; limiter Redis failure makes readiness fail and auth requests return 503. Upload object cleanup is best effort after failed persistence; use the orphan cleanup command after its grace period.

Application rollback is distinct from schema rollback. Review each migration's backward compatibility before deploying. MySQL DDL is not generally transactional; retain the failed migration logs and fix the specific migration rather than resetting its history.

## Backups

Use `pg_dump`/`pg_restore` for PostgreSQL or `mysqldump`/MySQL restore tooling for MySQL. Back up upload objects separately and preserve metadata/object consistency. Schedule restoration exercises and define retention/RPO/RTO for the application. The template does not claim a tested production recovery procedure.
