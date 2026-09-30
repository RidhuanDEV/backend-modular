# Modular Express TypeScript Starter

Express 5, TypeScript strict, Prisma/PostgreSQL, Zod, JWT/RBAC, audit, PostgreSQL notifications with SSE, optional SMTP and Redis cache, rate limiting, local/S3 uploads, and OpenAPI generated from endpoint contracts.

## Notifications

An administrator with `manage_notifications` can call `POST /api/notifications` with `{ "recipientId": "uuid", "title": "...", "body": "...", "sendEmail": false }`. Authenticated recipients can call `GET /api/notifications` for their newest 50 items, `PATCH /api/notifications/:id/read`, and `GET /api/notifications/stream` for SSE. The response contains only `id`, `recipientId`, `title`, `body`, `emailStatus`, `readAt`, and `createdAt`. SSE polls PostgreSQL every three seconds, so notifications from other replicas appear without Redis. Connections close after 14 minutes; refresh the bearer token and reconnect using an authenticated `fetch` stream. Do not put bearer tokens in URLs.

SMTP is disabled by default. Set `SMTP_ENABLED=true` plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and optional matching `SMTP_USER`/`SMTP_PASSWORD` to send email to the recipient's stored address. If email fails, the database notification stays available with `emailStatus=FAILED`; `PENDING` may remain after a process crash during delivery. Guaranteed email delivery requires an application-specific outbox and retry worker. A large number of SSE clients increases PostgreSQL polling load. The notification API has its own Prisma migration.

On upgrade, run the seed explicitly to add `manage_notifications` and `manage_uploads` to the admin role. Existing custom roles need those grants assigned separately.

## Create a new project

Use the unified initializer (selects this template explicitly):

```sh
npx create-ridhuan-backend@latest my-api --template express-typescript --yes
npm create ridhuan-backend@latest my-api -- --template express-typescript --yes
```

The wizard writes `.env`, generates secrets, and installs dependencies. Use `--no-install` to defer installation or `--mode docker` to use containers without host SDK dependencies. It refuses a nonempty destination. Follow the generated `GETTING-STARTED.md` for your selected ports and services. The project is private by default. The separate `create-ridhuanbackendtemplate` package is the legacy Express-only initializer.

## Run manually

Requires Node 24.15.0 or newer within the supported package engine range, PostgreSQL 18, and a `.env` copied from `.env.example`. Redis is optional when `CACHE_ENABLED=false` and `RATE_LIMIT_STORE=memory`.

```sh
npm ci
npm run prisma:migrate:deploy
npm run seed
npm run dev
```

`/live` checks that HTTP is serving, and `/ready` checks PostgreSQL plus Redis when Redis is the required rate-limit store. `/health` remains a lightweight compatibility endpoint. Health endpoints bypass the public request quota so probes cannot exhaust it. Point deployment health probes to `/ready`. `/docs` serves Swagger UI with all-modules and per-module views; `/docs/openapi.json` serves the complete OpenAPI 3.1 specification.

## Run in containers

Docker Compose is optional; manual startup above remains supported. `docker-compose.yml` defines the services; `docker-compose.override.yml` exposes host ports through `APP_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, and `MINIO_PORT`.

```sh
cp .env.example .env
docker compose up --build -d --wait
docker compose exec app npm run seed:prod
```

The default stack is app + PostgreSQL. Compose runs the `migrate` service once and starts the app only after migration succeeds; each app replica does not run migrations. Set `CACHE_ENABLED=true`, `RATE_LIMIT_STORE=redis`, and `COMPOSE_PROFILES=redis` for Redis. For MinIO, set `UPLOAD_STORAGE=s3` and include `minio` in `COMPOSE_PROFILES`; `minio-init` creates the bucket. Both profiles can be combined as `COMPOSE_PROFILES=redis,minio`. The unified CLI configures these automatically. For an external S3 service, set `S3_ENDPOINT_DOCKER` and skip the MinIO profile. Run seed explicitly after the first migration. Outside Compose, run `npx prisma migrate deploy` as one release job before starting new replicas.

Set `CORS_ORIGINS` to a comma-separated list of browser origins. It is required when `NODE_ENV=production`; development defaults to `http://localhost:5173,http://localhost:3000` if omitted. No wildcard or credentialed CORS is enabled. Requests without `Origin` remain available to server-side clients.

Uploaded local files use a persistent Compose volume. When running manually, `UPLOAD_LOCAL_DIR` selects the directory. The template accepts PNG, JPEG, and PDF with signature checks; `UPLOAD_ALLOWED_MIME` can narrow this list. `POST /api/upload` uses multipart field `file`; `GET /api/upload/:id` returns metadata. Both require JWT and `manage_uploads` permission. No public file download route is enabled.

For orphaned objects after a failed database write or process crash, run `npm run uploads:cleanup` to list candidates older than `UPLOAD_ORPHAN_GRACE_HOURS`. Review them, then run `npm run uploads:cleanup -- --apply` to delete those without a metadata row. The script operates on the configured local directory or S3 bucket and skips keys outside the template's UUID format.

## Endpoint policies

`src/core/http/endpoint-registry.ts` is the source of method, path, access, audit, rate limit, cache, request schema, response schema, and OpenAPI metadata. Every endpoint must appear there and be mounted once; startup fails if a registered endpoint is missing. `src/core/http/mount-endpoint.ts` applies validation and middleware. `npm run make:crud product` adds a scaffold to the registry and app; fill in its Prisma model, Zod fields, response contract, and business mapping before use.

The defaults in the registry can be changed through `ENDPOINT_POLICIES_JSON` in `.env`, then redeployed. Example:

```dotenv
ENDPOINT_POLICIES_JSON='{"user.get":{"cache":"off","rateLimit":"internal","audit":"optional"}}'
```

Unknown endpoint IDs and invalid values fail at startup. `required` audit is written in the same Prisma transaction as a mutation and rejects the response if no audit is written. `optional` is best effort and logs write failures. `none` creates no activity row. GET endpoints changed to `optional` produce a metadata-only READ entry; changing a GET to `required` requires a service audit producer and is rejected by default. Snapshots redact secret-named fields. Historical audit JSON is redacted by the new migration.

Rate limits use `auth`, `public`, and `internal`, each configured with `RATE_LIMIT_*_WINDOW_MS/MAX`. The public limiter also protects authenticated routes before JWT parsing; the internal limiter then keys by user. Configure `TRUST_PROXY_HOPS` only for trusted reverse proxies. Memory rate limiting is suitable for one app instance. Set `APP_INSTANCE_COUNT` and use `RATE_LIMIT_STORE=redis` for multiple app instances. When the configured Redis limiter fails, auth requests fail closed while public/internal limiters pass through; monitor the Redis error logs.

Set `CACHE_ENABLED=true` to activate response data caching on registry endpoints marked `read`. Redis is best effort for the cache; DB reads continue when unavailable. Authorization checks always query PostgreSQL so user/permission changes do not depend on cache invalidation. BullMQ jobs still require Redis when used.

## Time contract and migration

Database instants use `timestamptz(3)` and API timestamps use ISO 8601 UTC. `src/core/time/time.ts` parses instants with explicit offset and formats in validated IANA zones such as `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`, or overseas zones. Client display should use the viewer's zone. Existing `timestamp` values are interpreted as **UTC** by migration `20260922120000_endpoint_foundation`; verify the source timezone and take a backup before running it against a populated production database.

The historical `20260922120000_endpoint_foundation` SQL was corrected so audit redaction works when upgrading a database that already contains audit rows on PostgreSQL 18. This changes that migration file's checksum. Existing deployments that applied the earlier file should review Prisma migration history before using `migrate dev` against the same database; use the normal release `migrate deploy` path for rollout. Never reset a populated database to reconcile a checksum.

## API documentation and checks

```sh
npm run build
npm run api-docs:check
npx prisma validate
docker compose config --quiet
npm run verify:template
```

`npm run build` compiles TypeScript and writes `dist/docs/openapi.json`. Runtime docs come from the same typed registry and Zod schemas. No OpenAPI JSDoc annotations or manual schema JSON synchronization are needed. See [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) for the controller/service pattern and rollout notes.

GitHub Actions also tests fresh and upgrade migrations against PostgreSQL 18, builds the Docker image, and smoke-tests the packed npm initializer. `create-ridhuanbackendtemplate` is released by `.github/workflows/publish.yml` through npm trusted publishing after its publisher is registered in npm. Run `npm pack --dry-run` in the initializer directory to inspect the files before a release.

HTTP defaults to port `3000`; `PORT` selects the manual API port and `APP_PORT` the Compose host port. The container always listens on `3000`. Set `REDIS_NAMESPACE` to a unique deployment namespace when projects share Redis; replicas of one deployment must use the same namespace. Build and dev scripts generate Prisma automatically. `verify:template` checks the standalone application; legacy initializer packaging is a repository-only check.
