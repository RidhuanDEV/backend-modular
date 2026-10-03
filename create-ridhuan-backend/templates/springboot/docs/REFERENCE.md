# Technical reference

Start with the [README](../README.md) for first-run setup. This guide keeps the detailed contracts, settings, examples, and operational reasoning behind the starter. Read [HARDENING-UPGRADE.md](HARDENING-UPGRADE.md) before applying migrations to existing data.

Java 25 LTS, Spring Boot 4.1.1 and Spring MVC. PostgreSQL (default) or MySQL 8.4; native migrations, JWT/RBAC, transactional audit, optional Redis quota/cache, local/S3 uploads, SSE notifications, SQL email outbox, cleanup and optional telemetry. HTTP defaults to 8080.

## Prepare and run
Use a Java 25 JDK. No global Maven required. Windows uses `mvnw.cmd`; Linux/macOS `./mvnw`.
```powershell
.\mvnw.cmd -B -DskipTests dependency:go-offline
.\mvnw.cmd -B "-Dmaven.test.skip=true" package
java -jar target/app.jar --app.mode=initialize
java -jar target/app.jar --app.mode=migrate
java -jar target/app.jar --app.mode=seed
java -jar target/app.jar --app.mode=http
# Separate process:
java -jar target/app.jar --app.mode=email-worker
```
Initialize refuses existing .env and performs no DB operations. For MySQL add `--db.provider=mysql`. Process/CLI env overrides local dotenv; quoted values use dotenv-java. Inspect the ignored .env and create the selected database before migrate. HTTP/worker never migrate or seed automatically. Repeat seed preserves an existing admin password.

```sh
docker compose build app
docker compose up -d --wait
docker compose --profile seed run --rm seeder
```
Use `-f compose.mysql.yaml` and the MySQL env sample for MySQL. Migration failure prevents HTTP/worker startup. Optional profiles: redis, s3, telemetry. Never use sample credentials in production.

## API
Public metadata source: contracts/endpoints.json (33 baseline operations). JSON is camelCase, UUID identifiers, UTC ISO dates, success `{success:true,data,meta?}`, error `{success:false,message,errors:[]}`. Mutation controllers never expose persistence entities/passwords. Docs: /docs; spec: /docs/openapi.json; module: /docs/specs/user.json.
```http
POST /api/auth/login
Content-Type: application/json

{"email":"admin@example.com","password":"from your local .env"}
```
Login/refresh returns `data.token` plus opaque `data.refreshToken`. Access expires after 15 minutes. Refresh families slide 30 days with no absolute cap. Consumed refresh replay revokes the family; logout of any historical token revokes it. Access JWTs issued earlier survive until expiry. RBAC reads current DB permissions and blocks grants beyond the actor's rights.

Upload multipart field is `file`. GET /api/upload/{id} defaults to JSON metadata; use `Accept: application/octet-stream` to download content. MIME uses content detection and allowlist. File/database failure uses compensation; 24h orphan cleanup is a fallback.
Notifications list is a descending array, 50 rows per page, X-Next-Cursor header. SSE uses Last-Event-ID UUID, recipient isolation, ordered batches of 50, heartbeat 15s, lifetime at most 14min/JWT expiry and 16 stream slots. Unknown/foreign cursor returns 400 before SSE headers. Stream closes on DB failure or inactive user. The bodyless HTTP/1.1 stream binds its exact native Tomcat connection ID and probes input EOF without blocking every3s; input must remain open while receiving events. This also releases slots when a proxy half-closes input but continues accepting heartbeat writes, before Servlet completion callbacks arrive. Buffered input is preserved and blocked output retains its five-second timeout.

## Operations
```sh
java -jar target/app.jar --app.mode=generate-module --module.name=Invoice
java -jar target/app.jar --app.mode=cleanup
# Explicit destructive operation; review dry-run first:
CLEANUP_DRY_RUN=false java -jar target/app.jar --app.mode=cleanup
```
Generator is offline, rejects invalid/reserved names and overwrite, adds DTO/controller/service/entity/repository, registry and provider migrations. Review drafts and explicitly grant manage_invoices. Cleanup is separate; default dry-run/batch500/retention30d; active refresh tombstones, pending/leased jobs and notifications survive. Audit deletion requires explicit retention and opt-in.

New rights must be bootstrapped by a database owner after migrating; an API actor cannot grant a right it does not already hold. For the generated Invoice example, run this reviewed statement in the selected database:
```sql
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='ADMIN' AND p.name='manage_invoices'
AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);
```

Email worker defaults: concurrency2, poll3s, lease60s, renewal20s, SMTP timeout25s, attempts5, retry5/30/120/600s. SMTP is outside claim transactions; fencing rejects obsolete completion. Disabled SMTP idles without DB polling. Delivery is at least once; crash after SMTP acceptance can duplicate email.
Settings are env plus redeployment. Multi-instance quota requires Redis. Cache failure bypasses; Redis as quota store makes readiness fail; auth quota fails closed during Redis outage. Forwarded headers are ignored; configure a trusted ingress that preserves actual peer identity or use an explicit reviewed proxy implementation.

Read [setup](SETUP.md), [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md), [upgrade](UPGRADE.md), [testing](TESTING.md) and [dependency evidence](../DEPENDENCIES.md). Local gates do not establish production capacity, backup restore or external-service delivery.
