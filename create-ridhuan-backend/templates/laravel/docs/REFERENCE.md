# Technical reference

Start with the [README](../README.md) for first-run setup. This guide keeps the detailed contracts, settings, examples, and operational reasoning behind the starter. Read [HARDENING-UPGRADE.md](HARDENING-UPGRADE.md) before applying migrations to existing data.

Laravel 13 / PHP 8.5 (64-bit), PostgreSQL or MySQL, native FormRequests, readonly DTOs, Eloquent, Resources, gates, JWT/RBAC and Artisan. Optional Redis cache/shared quota, local/S3 uploads, SQL notifications/SSE, SMTP outbox, retention and portable OpenTelemetry.

## Manual Windows/Linux setup

Install PHP 8.5 x64 and Composer 2.9.8+. Extensions: PDO, selected pdo_pgsql/pdo_mysql, ctype, curl, dom, fileinfo, mbstring, openssl, tokenizer and xml; zip improves package installation. Redis/OTel PECL extensions are optional. On Windows ComposerSetup/Herd batch launchers are supported by the unified CLI; RIDHUAN_PHP_BINARY and RIDHUAN_COMPOSER_PHAR select isolated native executable/PHAR paths.

```sh
composer install --no-interaction --prefer-dist
php artisan backend:initialize --provider=postgresql --port=8000
# Edit ignored .env: provision dedicated DB and configure credentials first.
php artisan backend:migrate --force
php artisan backend:seed
composer build
php artisan backend:validate-config
php artisan serve --host=127.0.0.1 --port=8000
# Separate terminal, when SMTP enabled:
php artisan notifications:work
```

No SQLite fallback. For MySQL use initializer --provider=mysql and a separate database. Native migrate/status/rollback use only selected provider history. Composer discovery and initialization never query the database. Initialization refuses to replace existing .env; migrations/seed are explicit. Seed reruns preserve existing passwords and customized grants. Initial admin credentials are saved only in ignored .env.

/live and /health are independent of DB/Redis; /ready verifies DB and Redis when distributed quota is selected. /docs serves the API explorer; /docs/openapi.json and /docs/specs/{module}.json come from Scramble and source requests/resources/routes.

## Containers

```sh
# Set DB_PASSWORD and matching POSTGRES_PASSWORD in .env, plus APP_KEY/JWT secrets.
docker compose up --build -d --wait
docker compose exec app php artisan backend:seed
# Source checkout MySQL uses its provider file:
docker compose -f compose.mysql.yaml up --build -d --wait
docker compose -f compose.mysql.yaml exec app php artisan backend:seed
```

Host HTTP defaults to 8000 on web:8080. app is PHP-FPM, worker runs notifications:work, migrate completes once before app/worker; seeder profile stays explicit. PostgreSQL 18 stores /var/lib/postgresql, MySQL 8.4 owns a separate volume. All services have project scoped names. Redis, MinIO and Collector are optional profiles. Host dependency ports bind loopback; production TLS/domain/private DB topology needs deployment configuration. No fixed container names.

## Contracts

33 operations are traced to Express source 55198bb. Public camelCase fields, UUIDs and UTC ISO timestamps use explicit resources. Laravel validation returns 422; malformed/unknown/foreign notification cursor returns 400 before SSE headers. User pagination supports page/limit/search/sortBy/orderBy/fields with public projection. POST/PATCH/DELETE require their concern permissions. Role/user managers cannot grant or modify roles outside their own permissions. JWT access lasts 15 minutes, refresh slides 30 days without an absolute cap. Replay revokes its family and commits before responding 401; logout consumes known old traces and returns 204 for unknown/repeated tokens. Existing access lasts until expiry, active user lookup remains authoritative. Refresh/logout default audit is required in this Laravel profile.

Uploads default max 10 MiB and PNG/JPEG/PDF detected content. GET /api/upload/{id} keeps baseline metadata; optional ?download=true returns private streamed bytes under manage_uploads. Metadata hides internal keys. SQL/audit failure compensates objects; crash orphans are handled after grace and final reference recheck. Filesystem/object store and SQL are separate transactions.

Notifications list newest 50 and expose X-Next-Cursor when older data exists. SSE uses bearer headers, UUID Last-Event-ID and internal sequence; never put tokens in URLs. Initial stream sends unread items; resumed streams include read items after the recipient cursor. Native stream drains batches before polling 3s, heartbeat15s, stops on expiry/inactive/disconnect/DB outage. FPM defaults to 8 children with 4 SSE slots, preserving ordinary HTTP capacity. artisan serve is development-only. See deployment limitations.

## Configuration and operations

Environment changes require redeployment: php artisan config:clear, update .env/injected configuration, php artisan config:cache, restart HTTP and worker. Never build config cache containing deployment secrets into an image. APP_KEY is distinct from JWT_SECRET. RATE_LIMIT_STORE=file uses Laravel file cache under bounded flock mutexes across FPM processes. Multiple app instances require Redis; namespaces identify one deployment. Auth quota outage returns503; public/internal use best effort file fallback. Cache is optional Redis; checks authorize from SQL before reading cache. Generation invalidation is deployment scoped; no global Redis flush. ENDPOINT_POLICIES_JSON allows only audit/cache/rateLimit with declared producer capabilities. Stream/mutations cannot be cached.

```sh
php artisan backend:cleanup --dry-run
php artisan backend:cleanup --apply
php artisan make:backend-module Invoice
php artisan backend:verify-contract
php artisan backend:openapi-export
```

Cleanup is bounded and explicit; active family traces, pending jobs, persisted notifications and referenced/fresh files survive. Audit deletion is disabled; opt in with retention365d. Module generation creates native name-field CRUD scaffolds, requests/data/resource/service/model/policy/registry and both migration drafts; review fields, migrate and grant its concern permission explicitly. It rejects collisions/path traversal and preserves existing modules.

SMTP defaults off and worker stays idle without DB polling. Enabled SMTP uses verified Symfony transport, immutable snapshots, SKIP LOCKED claims, five attempts and fenced leases. Parent renews every20s during blocking child delivery, default lease60s, SMTP timeout25s, child timeout120s. Retry delays5/30/120/600s. Abandoned fifth attempt becomes FAILED. SMTP is at least once; acceptance followed by process crash can duplicate delivery. Linux signals and Windows console events trigger bounded shutdown; --stop-file supplies a portable supervisor stop request. Children cannot finalize SQL jobs.

OTEL_ENABLED defaults false with no connections. Official API/SDK/exporter uses bounded HTTP OTLP export and service identity; operation/status/time only, no email, password, bearer, SQL bindings or request body. Collector outage is optional. Metrics/spans do not establish production throughput or recovery guarantees.

## Quality and verification

```sh
composer build
composer analyse
npm ci --ignore-scripts
npm run format:check
php vendor/bin/phpunit
node scripts/verify.mjs --stage native
node scripts/verify.mjs --stage integration
```

Scripts are fully authored before execution, record independent failures, timeouts and cleanup evidence in OS TEMP. Gate status and actual limitations are recorded in docs/VERIFICATION.md. Configuring CI is separate from observing a passing run. npm integration is local/source until separately authorized npm release; no version bump/publish is implied.

Read docs/SETUP.md, docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, docs/UPGRADE.md and docs/TESTING.md. MIT.
