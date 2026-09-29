# Modular NestJS Backend Template

NestJS 12 modular monolith starter with PostgreSQL, Prisma 7, class based DTO validation, RBAC, activity audit, short lived access tokens, rotating refresh tokens, uploads, PostgreSQL notifications with SSE, and generated OpenAPI. Redis cache, distributed rate limits, S3/MinIO, and SMTP are optional. This folder is a standalone Git repository; the root `create-ridhuan-backend` CLI contains a copy of this template. Publishing the npm initializer is a separate release step.

## Quick start

Use Node.js 24.15 or newer. Copy `.env.example` to `.env` and replace `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and database credentials. Production also requires an explicit `CORS_ORIGINS` list.

### Docker Compose

```powershell
Copy-Item .env.example .env
# Edit .env secrets and ports.
docker compose -f compose.yaml up -d --build
docker compose -f compose.yaml exec app node dist/tools/seed.js
```

Compose starts PostgreSQL, runs a one shot `prisma migrate deploy` service, then starts the API only after migration succeeds. `GET http://localhost:3000/live` shows process liveness; `GET /ready` checks required dependencies. Use `compose.override.yaml.example` as a reference for host port overrides. Enable Redis or MinIO with `--profile redis` or `--profile s3` and set the corresponding env values. The S3 bucket must exist before upload. The optional MinIO profile builds a pinned community release from official source, so its first build takes longer.

### Manual

```powershell
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run build
npm run seed
npm start
```

`npm run prisma:migrate:dev` is for creating migrations during development. Run `migrate deploy` once as a release job before starting new replicas. Seed is explicit and idempotent; it creates `admin` and `user` roles, the five built in permissions, and the admin account if absent. It does not reset existing passwords.

On upgrade, run the explicit seed to grant `manage_notifications` and `manage_uploads` to the admin role. Assign these permissions separately to existing custom roles where appropriate.

## API

The live docs are at `/docs`; machine readable specs are `/docs/openapi.json` and `/docs/specs/{module}.json`. `GET /health` is a compatibility alias, `/live` is independent of PostgreSQL, and `/ready` checks PostgreSQL plus Redis when Redis backs rate limits. Feature routes use `/api`.

```powershell
$body = @{ email = 'admin@example.com'; password = 'your-admin-password' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType application/json -Body $body
$headers = @{ Authorization = "Bearer $($login.data.token)" }
Invoke-RestMethod -Uri http://localhost:3000/api/auth/me -Headers $headers
$refresh = @{ refreshToken = $login.data.refreshToken } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/refresh -ContentType application/json -Body $refresh
curl.exe -X POST http://localhost:3000/api/upload -H "Authorization: Bearer $($login.data.token)" -F "file=@example.png"
```

Access tokens expire after 15 minutes. Refresh tokens are random opaque values stored only as SHA-256 hashes; each refresh rotates once within a 30 day absolute family lifetime. Replay revokes the family. Logout accepts `refreshToken` and revokes that family. Public user responses contain only explicit DTO fields.

Registration returns a public user DTO. Login and refresh return only `token` and `refreshToken`. Logout returns HTTP 204 without a response body. The route and default policy baseline is pinned in `contracts/express-endpoints.json` and checked by `npm run verify:contract` after build.

## Structure and conventions

`src/modules` holds feature controllers, services, request DTOs, and response DTOs. `src/platform` owns Prisma, Redis, storage, SMTP, SSE, and time helpers. `src/common` owns the typed endpoint registry, guards, cache, audit, HTTP envelope, and pagination. `prisma/schema.prisma` and `prisma/migrations` are NestJS's own PostgreSQL history. Do not apply the Express or Go migrations to this database.

Every controller action gets a typed `@Endpoint('module.action')` ID. `src/common/endpoint/endpoint.registry.ts` defines method/path, visibility, permission, audit mode, cache mode, rate group, and status. Startup rejects missing or duplicate registry routes and OpenAPI operations. Override only `audit`, `cache`, or `rateLimit` on known IDs through `ENDPOINT_POLICIES_JSON`, then redeploy. Example:

```env
ENDPOINT_POLICIES_JSON={"user.get":{"cache":"off"},"auth.login":{"audit":"required"}}
```

The built in rate groups are `auth`, `public`, and `internal`; each has window and max env keys. Login, registration, refresh, and logout consume the auth quota before DTO or database work. Use `RATE_LIMIT_STORE=redis` whenever `APP_INSTANCE_COUNT>1`. Give each deployment its own `REDIS_NAMESPACE` when sharing a Redis server. Auth fails closed if Redis is unavailable; public/internal requests continue with a warning. Redis used only for cache is optional and `/ready` ignores its outage.

`required` audit is written in the same Prisma transaction as a mutation; `optional` audit errors are logged without failing the request; `none` skips it. Audit snapshots use explicit public fields. PostgreSQL stores UTC instants as `timestamptz(3)` and HTTP sends ISO UTC. `TimeService` handles IANA zones, including Jakarta and Makassar, at presentation boundaries.

Uploads accept multipart field `file`. Allowed MIME and size are configured in env; a matching PNG/JPEG/PDF signature is required. Objects use random UUID keys; the API exposes metadata without exposing storage paths or public download URLs. Storage can be local or S3 compatible. `npm run uploads:cleanup` scans for unreferenced objects older than the grace period and prints them. Pass `-- --apply` to delete candidates after review.

`NotificationsModule` persists notifications in PostgreSQL and exposes four authenticated routes: `POST /api/notifications` (`manage_notifications`), `GET /api/notifications`, `PATCH /api/notifications/{id}/read`, and `GET /api/notifications/stream`. The create body is `{ "recipientId": "uuid", "title": "...", "body": "...", "sendEmail": false }`. The recipient's stored email is used only when `sendEmail=true`; SMTP is disabled by default. The response DTO includes `id`, `recipientId`, `title`, `body`, `emailStatus`, `readAt`, and `createdAt`. `emailStatus` is `NOT_REQUESTED`, `PENDING`, `SENT`, or `FAILED`. SMTP failure leaves the database notification available. SSE polls PostgreSQL every three seconds, so replicas see each other's notifications without Redis. Each connection closes after 14 minutes; refresh the access token and reconnect. Use an authenticated `fetch` stream with an Authorization header; do not put bearer tokens in a URL. `GET` returns the newest 50 notifications. Polling can add database load with many connected clients. A process crash during email delivery may leave `PENDING`; delivery retry/outbox is application-specific.

`SseModule` also exports an in-process `SseBroker` for other features; the Notifications SSE route uses PostgreSQL polling for cross-replica delivery. The original Express route baseline remains 29 operations; Notifications adds four.

Create a feature skeleton after building:

```powershell
npm run build
npm run generate:feature -- invoices
```

The generator adds a module, empty controller, service, DTO, and policy draft. Define the business contract, registry entry, permissions, response mapper, and tests before adding a route. It refuses duplicate or unsafe names.

## Configuration

| Env | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL for this template only |
| `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` | Access JWT signing and validation |
| `CORS_ORIGINS`, `TRUST_PROXY_HOPS` | Explicit browser origins and trusted proxy hop count |
| `ENDPOINT_POLICIES_JSON` | Startup overrides for registered endpoint policies |
| `APP_INSTANCE_COUNT`, `RATE_LIMIT_STORE`, `RATE_LIMIT_*` | Single/multiple replica quotas |
| `CACHE_ENABLED`, `REDIS_URL`, `REDIS_NAMESPACE` | Optional cache or required distributed limiter, with a deployment-specific key prefix |
| `UPLOAD_ENABLED`, `UPLOAD_STORAGE`, `UPLOAD_*`, `S3_*` | Local or S3 upload limits and storage |
| `SMTP_ENABLED`, `SMTP_*` | Optional outbound mail provider |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Explicit seed account credentials |

See `.env.example` for all keys and defaults. Store actual secrets in deployment secret storage or local `.env`, which is ignored by Git. File storage and logs are also ignored.

## Checks and operations

`npm run verify:template` generates Prisma Client, compiles the Nest app, validates TypeScript and the Prisma schema, checks the pinned Express route contract, and runs service free HTTP tests. CI is configured to run PostgreSQL migrations, seed, database HTTP tests, Redis two instance rate limit tests, MinIO upload tests, OpenAPI export, Docker image build, and Compose smoke. `npm audit --audit-level=high` is a CI gate.

Back up PostgreSQL and the upload object store together. To restore, stop writes, restore the matching database dump and local upload volume or S3 bucket, then run `prisma migrate deploy` before replicas restart. Verify a sampled upload and an authenticated request after restoration. Do not treat `/live`, a successful build, or CI alone as evidence of production capacity, backup recovery, and high availability in a particular VPS.

The prior MySQL prototype and its logs are in the ignored `.legacy` folder; it is not part of this template's runtime. This template does not migrate data from that prototype automatically.
