# Architecture

Controllers adapt FormRequests to readonly DTOs; services authorize and mutate; Eloquent/query builder own SQL; Resources explicitly choose public fields. App namespace stays native. Storage has a provider interface because local/S3 differ. No repository interface per entity. Actor and telemetry are scoped bindings. Native provider boot does not open SQL/Redis.

EndpointId enum and readonly definitions build routes, policy and OpenAPI metadata. Runtime boundary narrowing checks decoded JWT/JSON/config/validated fields. PHPStan level max has no baseline/global suppressions. Framework mixed signatures are narrowed at adapters. strict_types applies to owned PHP.

PostgreSQL uses UUID/TIMESTAMPTZ/JSONB; MySQL UUID CHAR36/DATETIME6/JSON and InnoDB uniform FK collation. Both signed BIGINT notification counters remain internal. UTC stored/serialized, IANA presentation zones do not affect expiry. Database credentials never become SQL fragments. Framework session/queue is stateless/sync; custom SQL outbox is separate from Laravel queue:work.

Mutations and required audit share native transactions. Optional audit runs in a nested savepoint, preventing PostgreSQL transaction poisoning. Snapshots strip password/token/secret/address/body. Refresh and logout use family locking; replay returns an outcome and throws only after commit. Notification recipient lock allocates sequence and snapshots recipient email, then notification/job/audit commit together.

Quota file stripes use flock ownership, with Laravel file-cache TTL buckets; Redis uses one Lua increment/expire. SSE admission uses independent flock slots. Worker parent claims, renews and finalizes only matching unexpired lease IDs; child SMTP never holds a SQL transaction or completes a job. Crash recovery is fenced, SMTP remains at least once.
