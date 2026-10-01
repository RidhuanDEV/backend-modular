# Contract decisions

The endpoint inventory is derived from the actual registry, Pydantic DTOs and routers, with 33 operations. Common features follow the Express/Nest/Go/.NET templates; each framework keeps its native contract where reference templates differ.

- FastAPI uses `token` and `refreshToken`; .NET retains `accessToken`. Logout is idempotent and revokes the refresh family.
- FastAPI uses Argon2 rather than bcrypt. Registration accepts 6–1024 characters and does not inherit bcrypt's 72-byte truncation limit.
- Invalid DTOs return the template's failure envelope and HTTP 400 rather than FastAPI's default 422.
- Roles and permissions use explicit public DTOs. Permission renaming/deletion checks the actor's held grants; admin remains the seed bootstrap role.
- UTC timestamps retain microseconds in FastAPI; Prisma and Go retain their established millisecond storage precision.
- Refresh expiry is absolute for a family rather than extended by each rotation.
- SSE ordering uses an internal per-recipient sequence rather than timestamps/UUID ordering. The wire event ID is still a UUID, and unknown/foreign cursors are rejected before the response starts.
- Health probes bypass rate limiting. Redis used only for caching never fails readiness; Redis used by the limiter does.
- The initial caching example is `user.get`; endpoint overrides are limited to implemented cache/audit producers.

Changing provider does not convert data. PostgreSQL native UUID/timestamptz/JSONB map to MySQL char UUID/datetime UTC/JSON. PostgreSQL/MySQL histories are separate and model drift is checked against each actual engine.
