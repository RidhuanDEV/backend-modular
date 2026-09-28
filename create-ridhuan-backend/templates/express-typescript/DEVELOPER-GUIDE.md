# Developer guide

## Add an endpoint

1. Define Zod body, query, params, and response schemas in the module. The request DTO should use `z.input` or `z.output` according to whether it is before or after parsing. Never derive a public response from a Prisma model with private fields.
2. Add a unique endpoint ID and method/path to `src/core/http/endpoint-registry.ts`. Set `access`, `audit`, `rateLimit`, `cache`, success status, and schema references explicitly.
3. Implement a controller method that calls a service and returns through `sendSuccess`, `sendCreated`, or `sendNoContent`. Controllers handle HTTP only.
4. Mount once with `mountEndpoint(app, "module.operation", controller.operation)` in a module route registration function; call that function in `src/app.ts`.
5. Run `npm run build` and inspect `/docs/openapi.json`. The spec derives from registry/Zod and has one operation per mounted endpoint.

`npm run make:crud <name>` creates a scaffold and updates registry/app wiring. It deliberately leaves schema fields and the Prisma model for the developer to define. Review the generated response schema and permission policy before using the route.

## Audit contract

Use the registry for **policy** and the service for **facts**. On a mutation, read the authoritative before/after database state, write the domain change and `auditService.persist({ action, module, entityId, userId, before, after, requestId, trx })` in the same Prisma transaction. For `required`, audit failure rolls back the transaction. A response helper checks that a required audit was written. For `optional`, the service queues an audit write after the handler returns; a failure is logged and the mutation remains committed. For `none`, the write is skipped. An optional GET can record a metadata-only READ entry automatically.

The audit repository converts snapshots to JSON and recursively redacts keys matching password, token, authorization, secret, API key, credential, or cookie. Prefer explicit allowlisted snapshot projections in each service as the first boundary; recursive redaction is defense in depth. Do not send full request headers or file bytes. The audit table is append-only. No API to mutate audit rows is provided.

## Cache and rate limit

Business read caches use `cacheService`; their endpoint must be marked `cache: "read"`. Writes invalidate relevant keys after commit. Cache failure falls back to PostgreSQL. Use a Zod schema when reading untrusted JSON from Redis. User status and RBAC authorization read PostgreSQL on every request; do not cache them through the business cache. Rate-limit groups and env values are defined in `src/core/middleware/rate-limit.middleware.ts` and `src/config/env.ts`; add a typed group and env keys together when a new class is needed.

## Time and storage

Persist instants in UTC; send ISO UTC over HTTP. Parse user-supplied instants with `parseInstant` (requires an offset/Z), and format only at display boundaries with `formatInZone` plus a validated IANA zone. Dates without time are a separate business type. PostgreSQL `timestamptz` stores instants; the timezone of the server host must not decide the user's display hour.

The upload route parses multipart with Multer, checks size/type/signature, writes to the configured local or S3 adapter, and stores metadata plus audit in PostgreSQL. Filesystem/S3 and PostgreSQL cannot share a transaction. On DB failure the service attempts to remove the uploaded object. Operate a cleanup process for orphaned objects if the removal itself fails.
The `uploads:cleanup` command lists orphaned objects by default and only removes them with `--apply`; the grace period is configured through `UPLOAD_ORPHAN_GRACE_HOURS`.

## Deploy checks

Before applying the new migration to an existing populated database, confirm whether its old `timestamp` columns represent UTC. The SQL migration interprets them as UTC and redacts historical audit JSON. Back up the database. Run `npx prisma migrate deploy` against a staging copy, check timestamps and audit rows, then deploy. A fresh database should also be migrated and seeded. Docker Compose profiles are optional; manual startup uses the same app code.

The app image only starts the HTTP process. Compose starts its one-shot `migrate` service first and requires a successful exit. In other deployment systems run migration as a single release job before new application replicas. Run seed separately. Use `/live` for process liveness and `/ready` for PostgreSQL plus the required Redis rate-limit store; cache-only Redis failure does not remove the instance from service. `CORS_ORIGINS` is mandatory in production and lists exact browser origins.

To release the initializer, bump `create-ridhuanbackendtemplate/package.json` version, run `npm run verify:template`, and inspect `npm pack --dry-run` in that package. The publish workflow requires the npm package to be connected to this repository and `.github/workflows/publish.yml` as a trusted publisher; npm authentication is required for initial registration. Do not include `.env`, uploaded files, or generated local artifacts in the package.

The root `package.json` overrides `deepmerge-ts` and `mysql2` because Prisma 7.10 pins older vulnerable versions. Recheck those two overrides when upgrading Prisma; remove an override once Prisma itself depends on a patched version. CI runs full and production-only npm audits so new advisories are visible before release.
