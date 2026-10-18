# Reference contracts and explicit differences

Reference inspection: 2026-09-26. Actual source: Express `src/core/http/endpoint-registry.ts`, module schemas, services, repository and user mapper, `prisma/schema.prisma`; Go `contracts/express-endpoints.json`, HTTP registry/types/routes and service. References were not modified.

The 27 reference operation method/path/ID/access/audit/rate/cache/status defaults are copied to contracts/express-endpoints.json. Registry validation compares mounted controller metadata; contract tests compare OpenAPI operation IDs. .NET adds `POST /api/auth/refresh` as an auth-rate-limited operation. Auth user DTOs expose only id, email, and roleId; login/refresh return a 15-minute access token and rotating opaque refresh token.

## Security changes

- Express auth queries do not filter deletedAt; .NET rejects soft-deleted accounts for login/JWT and hides them in user reads. This is an intentional correction, not a claim of identical legacy behavior.
- .NET JWT refreshes role/email from live database during validation. User deletion uses current role and rejects self-delete.
- Anti-escalation (all four templates, 2026-09-30): user create/update/delete and role update/delete/permission assignment require the target roles and granted permissions to be within the actor's own live permissions. This replaces the earlier admin-name-only delete check. Since 2026-10-18 no role is exempt: a new permission is granted to every role holding `manage_permissions`.
- System primitives (2026-10-18 audit): the five `manage_*` permissions and the `admin`/`user` roles cannot be renamed, deleted or recreated. Route policies and this list share `BackendService.SystemPermissions`. Role and permission names are trimmed before these checks.
- No change (user delete, role change, permission reassignment) may leave a system permission without an active holder (locking read on the system permission rows). Deleting a user or changing its role revokes all of its refresh families and tokens.
- File metadata is returned only to the uploader or an `admin` user; everyone else receives 404.
- Rate limiting runs before the user is loaded from the database: the JWT is verified without a query, one quota is charged per request (no extra shared IP bucket for authenticated calls), then `ActiveUserMiddleware` loads the live user.
- Soft-deleted accounts pay the same password verification as active ones. JSON request bodies are limited to 1 MiB; only `upload.create` keeps the upload-sized limit. `/docs` is disabled in Production unless `Docs__Enabled=true`.
- Unknown-email logins verify against a dummy hash so response time does not reveal account existence; login deletes the user's already-expired refresh tokens. Unhandled 500s log the exception server-side.
- Refresh tokens are stored only as SHA-256 hashes, rotated in serializable database transactions, and reuse revokes the active token family. Absolute family lifetime is `RefreshToken__AbsoluteDays` (default 90) and is never extended by rotation; each token lifetime is `RefreshToken__IdleDays` (default 30), capped at the family expiry.
- Refresh token transport is `body` by default; `RefreshCookie__Transport=cookie` moves it to an httpOnly cookie (path `/api/auth`) and requires `X-Requested-With` on cookie-authenticated refresh/logout.
- Required mutation audit is atomic. DB serialization/unique/FK/concurrency conflicts map to 409, preserving database internals.
- Default .NET Identity hashing is intentionally different from bcrypt. No automatic hash/account sharing; separate PostgreSQL database and EF migration ownership are required.
- Pagination outside page >= 1, limit 1..100 returns 400; reference schemas accept unconstrained integers, which can reach invalid persistence parameters. This bounded contract is explicit.

## User query discrepancy

Express query configuration declares selectable id/email/roleId, but UserRepository.findAll ignores its select and UserMapper always returns full fields. Go validates a larger fields allowlist and also returns full fields. The .NET implementation applies the documented id/email/roleId allowlist and omits unselected fields using a typed projection DTO. Unknown fields are filtered; no allowed fields means full default response, matching reference builder fallback. This corrects the documented feature rather than copying the ineffective reference repository select. It is an explicit semantic difference.

## Internal differences

- Official Microsoft OpenAPI generates schemas from API explorer/DTOs. /docs is a static link page; no CDN or interactive third-party UI.
- PostgreSQL durable cache_generation is an additional internal table. Its version increments with mutations; Redis version also increments after commit. This prevents stale cache revival after invalidation outage; it adds one database version read on cache lookup and serializes version updates.
- Serialization uses millisecond UTC Z timestamps. Domain audit snapshot serialization is typed and redacted again before JSONB persistence.
- Memory rate limit is per-instance; Redis Lua INCR/PEXPIRE is shared. Auth outage 503, public/internal fail open, probes bypass quota.

Full semantic parity, rollback/optional failure, concurrency and service outage coverage are runtime gates; registry/OpenAPI success alone is insufficient.
