# Upgrade
No shared database or history with another template. V1 core and V2 sessions/notifications/outbox are native Spring histories. Preserve released checksums. New changes create V3+ scripts for both providers; no ddl-auto update/create.
Upgrade fixtures target V1 native pre-release core, then run current migrations and ensure users/passwords survive. They are not imports from Prisma/Go/.NET/Laravel.
Before upgrade: back up database, inspect env diff, build artifact, run migrate once, explicit seed if needed, deploy HTTP/worker, verify readiness. Provider switching creates another project/database and needs a separate data migration plan.
Cleanup dry-run is default. Set CLEANUP_DRY_RUN=false explicitly to apply. Audit purge additionally requires CLEANUP_AUDIT_ENABLED=true and explicit CLEANUP_AUDIT_RETENTION_DAYS. At-least-once email semantics remain; coordinate planned worker stops with lease expiry.
