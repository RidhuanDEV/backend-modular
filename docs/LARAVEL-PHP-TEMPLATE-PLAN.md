# Rencana Lengkap Template Laravel PHP

Tanggal: 3 Oktober 2026. Status: **implementasi selesai; build lulus; pengujian penerimaan akhir sedang dikumpulkan**. Instruksi pengguna terbaru mengizinkan testing, perbaikan, commit/push main dan pemantauan CI tanpa konfirmasi ulang; tidak mengizinkan bump versi/publish npm. Bukti terkini: [verifikasi Laravel](../modular-laravel/docs/VERIFICATION.md).

Dokumen pasangan: [Spring Boot Java](SPRING-BOOT-JAVA-TEMPLATE-PLAN.md). Acuan fitur: [hardening](BACKEND-HARDENING-ENHANCEMENT-PLAN.md), [handoff existing](BACKEND-HARDENING-REVIEW.md), [bukti pengujian existing](BACKEND-HARDENING-TEST-RESULTS.md).

## 1. Tujuan dan keputusan dasar

Laravel menjadi pilihan PHP pada npm CLI `create-ridhuan-backend`. Proyek hasil generation mandiri, mengikuti struktur Laravel dengan modul berdasarkan concern, mendukung PostgreSQL/MySQL dan seluruh fitur hardening template existing.

- Native Laravel routing, FormRequest, Eloquent, service container, policies/gates, API Resources, Artisan, Storage dan Mail dipakai sesuai concern.
- Redis/cache, SMTP, S3 dan telemetry opsional. Database aplikasi tetap wajib; PostgreSQL default.
- Provider dipilih saat generation. Setiap proyek memakai database/migration history sendiri. Perubahan provider tidak memindahkan data otomatis.
- Dynamic configuration menggunakan env dan redeployment, termasuk pembaruan config cache dan restart worker.
- Script pengujian lengkap disiapkan sebelum execution; testing adalah task terakhir sesudah review pengguna.
- Java dan Laravel dikoordinasikan melalui kontrak fitur serta shared CLI. Struktur bahasa/framework masing-masing tetap native.
- `doctor`, SDK client, idempotency, verifikasi email/reset password dan multi-tenancy mempunyai roadmap terpisah.

Target yang digunakan: `D:/Ridhuan Ngoding Moment/React/template-JS/modular-laravel`; repo Git terpisah. Pengguna memberikan remote `https://github.com/RidhuanDEV/modular-laravel.git`; origin dipasang, remote diverifikasi masih kosong. Commit/push menunggu seluruh gate dan cleanup. Source existing dibaca sebelum implementasi.

## 2. Source of truth dan kontrak wire

Baseline perencanaan root `b913b0e`, source CLI `1.4.0`; Express `55198bb`, NestJS `fa17926`, Go `dadd6dc`, .NET `afef88a`, FastAPI `2de7aad`. Recheck HEAD/source ketika implementasi dimulai; nama/versi npm registry tidak disimpulkan dari source package.json.

| Concern | Acuan |
| --- | --- |
| Routes/policy/DTO | Express `src/core/http/endpoint-registry.ts`, schema/controller/service/mapper; native registry/DTO framework lain |
| Auth/counter/outbox | Current refresh family transaction, notification service, jobs and cleanup sources |
| CLI installation | `src/{types,templates,arguments,process,instructions}.ts`, `src/scaffold`, `scripts/prepare-templates.mjs` |
| Acceptance | `verify-hardening*`, `verify-worker-retention`, provider upgrades, consumers, Compose, collecting runner |

Minimum **33 operations** mengikuti source Express saat ini. Jangan memakai sourceCommit historis pada manifest kontrak lama sebagai bukti parity current. Buat contract manifest baru dari route/controller/resource yang benar.

Wire menggunakan camelCase, UUID string, UTC ISO timestamps, public DTO allowlist, dan `token` + `refreshToken` pada auth. Success envelope/pagination diturunkan dari source baseline dan diterapkan eksplisit melalui resources. Native Laravel validation **422** dipertahankan sebagai keputusan kontrak yang didokumentasikan; auth error 401, forbidden 403, notfound 404, conflict 409. Invalid SSE cursor unknown/foreign tetap **400 sebelum headers**. Profile acceptance/OpenAPI mencatat perbedaan validation status; jangan menyebut respons identik tanpa evidence.

| Operation ID | Method dan path | Sukses |
| --- | --- | --- |
| health.get / live.get / ready.get | GET /health; GET /live; GET /ready | 200; readiness dependency gagal 503 |
| docs.spec / docs.moduleSpec / docs.ui | GET /docs/openapi.json; GET /docs/specs/{module}.json; GET /docs | 200 |
| auth.register | POST /api/auth/register | 201 |
| auth.login / auth.refresh | POST /api/auth/login; POST /api/auth/refresh | 200 |
| auth.logout / auth.me | POST /api/auth/logout; GET /api/auth/me | 204 / 200 |
| user.list / user.get | GET /api/users; GET /api/users/{id} | 200 |
| user.create / user.update / user.delete | POST /api/users; PATCH /api/users/{id}; DELETE /api/users/{id} | 201 / 200 / 204 |
| role.list / role.get | GET /api/roles; GET /api/roles/{id} | 200 |
| role.create / role.update / role.delete | POST /api/roles; PATCH /api/roles/{id}; DELETE /api/roles/{id} | 201 / 200 / 204 |
| role.assignPermissions | POST /api/roles/{id}/permissions | 200 |
| permission.list / permission.get | GET /api/permissions; GET /api/permissions/{id} | 200 |
| permission.create / permission.update / permission.delete | POST /api/permissions; PATCH /api/permissions/{id}; DELETE /api/permissions/{id} | 201 / 200 / 204 |
| upload.create / upload.get | POST /api/upload; GET /api/upload/{id} | 201 / 200 |
| notification.create / notification.list | POST /api/notifications; GET /api/notifications | 201 / 200 |
| notification.read / notification.stream | PATCH /api/notifications/{id}/read; GET /api/notifications/stream | 200; stream text/event-stream |

Bare `/` tidak menjadi acceptance wajib. Default Laravel `/up` dan docs framework routes dinonaktifkan/dipetakan atau diinventarisasi secara eksplisit supaya semua exposed HTTP operations memiliki policy yang diketahui.

## 3. Runtime dan dependency

Baseline **Laravel 13.x, PHP 8.5 64-bit, Composer 2.x**. Laravel 13 menerima PHP 8.3–8.5 menurut [support policy resmi](https://laravel.com/framework/docs/releases). Pilih patch aktif dan Composer version/image digest konkret setelah pemeriksaan compatibility/dependency saat implementasi; Laravel 12 tidak dipilih otomatis hanya karena library lama belum mendukung 13.

| Concern | Pilihan |
| --- | --- |
| Framework | laravel/framework, framework-native application skeleton |
| Persistence | Eloquent/Query Builder, PDO pgsql/mysql; provider official extensions |
| DTO/validation | FormRequest, PHP readonly DTO, enum, typed mapper dan API Resource |
| Access JWT | SDK JWT maintained `firebase/php-jwt` melalui custom Laravel Guard adapter; verify Composer metadata/version |
| Password/crypto | Laravel Hash/Crypt/Str, native secure random bytes; secret APP_KEY terpisah dari JWT_SECRET |
| Authorization | Laravel policies/gates; model Role/Permission/RolePermission explicit sesuai baseline |
| Redis | Laravel Redis integration; Predis sebagai portable default, PhpRedis opsi bila extension tersedia |
| Cache/quota lokal | Laravel file cache + atomic locks lintas FPM process; Redis untuk multi-instance |
| Upload/S3 | Laravel UploadedFile/Storage, Flysystem S3 adapter dan AWS SDK for PHP |
| SMTP | Laravel Mail dengan Symfony Mailer transport |
| SSE | Symfony StreamedResponse melalui Laravel response/controller |
| OpenAPI | dedoc/scramble dari FormRequest/Resources/routes; extension terbatas untuk envelopes/policy/SSE/binary |
| Telemetry | OpenTelemetry PHP SDK/API/exporter resmi; instrumentation eksplisit yang portable |
| Static quality | Larastan/PHPStan maximum supported level, Laravel Pint, Composer validate/audit |
| Testing | PHPUnit compatible dengan runtime/framework, Laravel HTTP tests, real provider/SMTP/Redis/S3 fixtures |

JWT SDK dan Scramble merupakan package maintainer pihak ketiga yang dipilih untuk kebutuhan kontrak; bukan package first-party Laravel. Verifikasi compatibility published release dengan Composer lock. Source Scramble main menyatakan Illuminate 13 support, tetapi metadata branch main sendiri bukan bukti versi release dapat diinstal. [Scramble Composer source](https://github.com/dedoc/scramble/blob/main/composer.json), [JWT maintainer](https://github.com/googleapis/php-jwt), [Scramble getting started](https://scramble.dedoc.co/usage/getting-started).

Simpan composer.lock; consumer menjalankan install dari lock, tidak update saat generation. Pin plugin Composer dan allow-plugins secara eksplisit. Lisensi/publisher/extension/compatibility dicatat di DEPENDENCIES.md. Tidak membuat implementasi crypto, JWT signing atau protocol Redis/S3 sendiri. PHPDoc hanya untuk generic/array-shape/static analysis yang diperlukan; OpenAPI berasal dari source validation/resources, dengan native attributes untuk detail yang tidak dapat diinfer.

PHP extensions baseline: PDO, pdo_pgsql/pdo_mysql sesuai provider, OpenSSL, mbstring, fileinfo, tokenizer, XML/DOM, ctype, curl dan requirement Composer aktual. Redis extension dan OTel PECL tidak menjadi syarat saat fitur optional nonaktif. SDK telemetry manual menjadi baseline portable, dengan auto-instrumentation extension sebagai opsi terdokumentasi setelah compatibility verified. [OTel PHP](https://opentelemetry.io/docs/languages/php/).

## 4. Struktur Laravel

```text
modular-laravel/
  artisan, composer.json, composer.lock
  bootstrap/{app.php,providers.php}
  config/{app,database,auth,cache,filesystems,mail,endpoint,telemetry,...}.php
  routes/{api.php,web.php,console.php}
  app/
    Providers/{AppServiceProvider,EndpointServiceProvider,...}.php
    Http/Middleware/            # request context, registry, quota/security
    Support/
      Endpoint/                # enum, definition, registry, overrides
      Http/                    # API errors/envelopes
      Time/, Audit/, Observability/
    Modules/
      Auth/{Http,Data,Services,Models}/
      Users/{Http,Data,Services,Models,Policies}/
      Roles/, Permissions/
      Uploads/{Http,Data,Services,Models,Policies}/
      Notifications/{Http,Data,Services,Models,Policies}/
    Infrastructure/
      Storage/, Mail/, RateLimit/, Cache/, Outbox/
    Console/Commands/
      BackendInitialize.php, BackendSeed.php
      NotificationsWork.php, BackendCleanup.php, MakeBackendModule.php
  database/
    migrations/{postgresql,mysql}/
    seeders/, factories/
  public/index.php              # satu-satunya application document root
  resources/views/              # UI docs/vendor assets bila diperlukan
  storage/{app/private,framework,logs}/
  contracts/endpoints.json
  scripts/{entrypoint.sh,nginx.conf,php.ini,php-fpm.conf,otel-collector.yaml,...}
  tests/{Unit,Feature,Integration,Fixtures}/
  docs/{ARCHITECTURE,SETUP,DEPLOYMENT,UPGRADE,TESTING}.md
  .env.example, .env.mysql.example, .gitignore, .dockerignore
  Dockerfile, compose.yaml, compose.mysql.yaml, compose.override.yaml.example
  README.md, AGENTS.md, DEPENDENCIES.md, LICENSE
```

PSR-4 tetap `App\`; Composer project name dan APP_NAME diubah oleh initializer, namespace Laravel tidak diubah sembarangan. Ini layout modular monolith yang dipilih; Laravel tidak menetapkan satu struktur enterprise wajib.

Controllers menangani request/response, FormRequest memvalidasi transport, readonly DTO membawa data tervalidasi, service menangani use case/authorization/transaksi, model/query builder menangani persistence dan Resource memetakan output. Tidak menambahkan repository interface untuk setiap model tanpa kebutuhan nyata. Storage/mail/outbox provider memiliki interface karena benar-benar ada adapter/lifecycle berbeda. Actor/policy context memakai scoped container binding sehingga tidak menjadi singleton mutable.

## 5. Strict PHP dan endpoint registry

- `declare(strict_types=1)` pada source milik template; function/method/property/return type explicit, enum untuk finite states.
- Larastan/PHPStan pada level tertinggi yang supported; tidak membuat global ignore, baseline berisi error baru, atau menjadikan mixed/untyped array sebagai kontrak aplikasi.
- Framework boundary `validated()`, decoded JWT/stdClass, JSON dan model dynamic attributes dinarrow menjadi readonly DTO/typed array-shapes. Framework-required mixed/array signature dibatasi pada adapter dan dinarrow sebelum masuk service.
- Entity output tidak mengandalkan `$hidden` saja. API Resources/DTO memilih field publik, DateTime/UUID/enum serialization eksplisit.
- Central registry berupa EndpointId enum + readonly EndpointDefinition; typed helper membentuk Laravel routes dan operation names dari registry.
- Startup/native verify membandingkan route table dengan registry: ID, path, method, DTO/status/media, permission, audit/capability, cache dan rate group. Route cache harus tetap dapat divalidasi.
- `ENDPOINT_POLICIES_JSON` hanya whitelist audit/cache/rate group. Unknown ID/key/group, required tanpa producer dan cache stream/mutation ditolak; workers/commands memuat config yang relevan tanpa query DB di provider boot.
- Default groups auth/public/internal. Concern permissions dipisahkan: manage_users, manage_roles, manage_permissions, manage_uploads, manage_notifications.
- Request ID dibatasi dan diclear per request/iteration worker. Proxy trust dan origin CORS exact allowlist, production origin mandatory, credentials false default; request tanpa Origin tetap diproses.

Registry middleware mengatur context/security/quota/cache; required mutation audit tetap berada di application service transaction. Jangan memasukkan write audit mandatory ke terminating middleware setelah response committed.

## 6. Model, database dan migration

Model minimum: User, Role, Permission, RolePermission, ActivityLog, StoredFile, RefreshFamily, RefreshToken, NotificationCounter, Notification, EmailJob. Tambahkan hanya infrastructure tables yang benar-benar dipakai framework/config; jangan mengaktifkan SQLite sebagai fallback test/runtime.

| Entity | Constraints |
| --- | --- |
| Users/roles/permissions | UUID, email/name unique menurut normalisasi source yang disepakati, role FK required, soft-delete/active semantics diturunkan dari baseline |
| RolePermission | Composite unique/PK, strict FK, cascade policy jelas |
| RefreshFamily/token | Family authoritative expiry/revocation, unique hash, FK user/family, consumed token history dan indexes |
| NotificationCounter | Recipient PK dan locked BIGINT increment |
| Notification | Unique recipientId+sequence, UUID wire ID, FK recipient/actor, email status/readAt/createdAt |
| EmailJob | Unique notificationId, immutable email snapshot, availability/attempts/leaseId/leaseUntil/completedAt/indexes |
| ActivityLog | Actor snapshot, sanitized before/after JSON, endpoint/request/time indexes, nullable actor FK where needed |
| StoredFile | Unique objectKey, status/provider metadata, safe filename/MIME/size/uploader FK |

Models memakai native casts, explicit fillable/guarded dan relation return types; mass assignment hanya menerima DTO allowlist. Enable preventLazyLoading untuk development/tests dan review eager loading/N+1 pada DTO mappings. Resource tidak melakukan query tersembunyi ketika response ditulis.

Migrations Laravel provider-specific melalui `php artisan make:migration`, Blueprint dan scoped native SQL untuk locking/backfill/index yang memang berbeda. Selector memakai connection/provider aktual dan hanya memuat history provider yang dipilih. `php artisan migrate` bawaan, migrate:status/rollback tooling dan helper release harus konsisten dengan path provider; larang menjalankan kedua histories pada satu database. Jangan mengedit migration ID/checksum yang telah dirilis.

PostgreSQL memakai UUID/TIMESTAMPTZ/JSONB; MySQL InnoDB memakai CHAR(36) UUID dengan charset/collation FK konsisten, DATETIME(6) UTC, JSON dan signed BIGINT. Jangan menggunakan cast SQL PostgreSQL/RETURNING pada MySQL tanpa adapter. Counter upsert dan SELECT FOR UPDATE memakai native DB/query builder di dalam transaksi.

Initial core dan hardening migrations boleh dipisahkan untuk fixture upgrade native pra-rilis: token/notification data lama ditambahkan sebelum family/counter backfill. Dokumentasikan fixture schema/version, preserve old expiry/revocation, deterministic createdAt+ID order, dan old PENDING tanpa job → FAILED. Ini tidak mengimpor database Express/Go/.NET ke Laravel.

Date handling: server Clock abstraction UTC, CarbonImmutable/DateTimeImmutable, DB connection timezone UTC, serialized ISO UTC, timezone conversion dengan IANA untuk Jakarta/Makassar/Jayapura dan DST luar negeri. Presentation zone tidak mengubah stored expiry. PHP wajib 64-bit untuk sequence BIGINT; sequence internal tidak diekspos sebagai JSON number untuk cursor.

DB identifiers: PostgreSQL username/database 63 byte ASCII; MySQL username 32 karakter, database 64. Validator terpisah di wizard/argument/env/initializer, sebelum generation/install. Credential dikirim sebagai field config, dengan round-trip dotenv quoting dan tidak dicetak ke log.

Seed via Artisan explicit/idempotent; role/permission concerns dan admin dibuat hanya bila perlu. Seed ulang tidak mengganti password admin atau privilege custom tanpa instruksi. User/role manager tidak dapat memberikan permission di luar miliknya.

## 7. JWT, refresh family, logout dan audit

Access JWT berlaku **15 menit**. Guard menggunakan SDK signing/verification, algorithm allowlist, issuer/audience/expiry/tokenUse, typed claims mapping dan user-active lookup. APP_KEY hanya untuk crypto Laravel; JWT_SECRET random terpisah. Token disampaikan melalui Authorization header; tidak berada di URL/cookie otomatis.

Opaque refresh minimal 32 random bytes; only SHA-256 hash persisted. Refresh expiry sliding **30 hari tanpa absolute cap**. Password menggunakan Laravel Hash bcrypt dengan cost/batas UTF-8 yang didokumentasikan; dummy comparison pada email unknown menjaga biaya login serupa. Login/register/refresh/logout memperoleh quota auth sebelum pekerjaan mahal.

Refresh transaction:

1. Temukan family dari hash; unknown → 401.
2. `DB::transaction`, lock family row, lalu baca ulang token di dalam lock.
3. Tolak user inactive, family expired/revoked dan token expired; expiry tidak dihidupkan kembali.
4. Replay consumed token mencabut family dan required audit. Kembalikan typed outcome dari transaction, kemudian respons 401 setelah commit; jangan melempar exception yang merollback revocation.
5. Valid rotation consumes old token, inserts replacement, extends family/token expiry UTC+30d dan writes required audit pada connection yang sama.

Logout body `{refreshToken}` → 204, termasuk unknown/repeated/revoked. Consumed token sebelum rotasi tetap mencabut family. Refresh/logout/replay memakai family lock yang sama; active-family consumed traces dipertahankan. Unknown/no-mutation logout tidak membuat audit mutation palsu. Access JWT existing tetap berlaku hingga expiry maksimum 15 menit.

Audit modes required/optional/none dan explicit producer capability mengikuti registry. Snapshot actor/module/behavior/entity/before/after/createdAt tidak memasukkan password, token mentah/hash, SMTP secret atau file bytes. Required audit atomic; optional insertion memakai savepoint/transaction-safe behavior, khususnya pada PostgreSQL agar error tidak membatalkan mutation. Safe log failure type saja. GET tanpa producer tidak menerima required override.

## 8. Rate limiting dan cache pada PHP runtime

PHP-FPM mempunyai beberapa proses; cache array/in-memory per request tidak menyediakan quota lintas request. **Default Laravel `RATE_LIMIT_STORE=file`** menggunakan Laravel file cache dengan mutex atomic pada read/update window, scoped per deployment dan TTL/bounded cleanup. Redis merupakan pilihan distributed dan wajib bila APP_INSTANCE_COUNT>1. Ini perbedaan native config yang eksplisit dari default JVM memory store.

- File lock berada di private cache directory per instance, writable oleh non-root PHP user. Timeout/bucket size/expiry terbatas.
- Fixed-window group auth/public/internal memakai env max/window seperti template existing. Jangan mengklaim atomic quota bila memakai `tooManyAttempts` lalu `hit` tanpa lock/atomic Redis operation.
- Redis quota menggunakan Lua/atomic operation melalui client Laravel yang terpasang. Namespace, group, identity scope dan TTL konsisten antar replica.
- Store failure: auth 503 fail-closed; public/internal best-effort local fallback/safe log. Health liveness tetap bekerja saat dependency down.
- Predis default menjaga Windows/manual tanpa Redis extension; PHPRedis optional diverifikasi bila dipilih. Redis disabled tidak melakukan connect saat application boot.
- Registry semua endpoint mempunyai group; group baru ditambah enum+config/env/comment+registry assignment.

Response cache berbeda dari rate store: optional Redis cache enabled/disabled, outage → bypass. Example user.list memakai key filter/page/sort serta authorization scope yang tervalidasi; authorization terjadi sebelum cache lookup. Auth tokens, stream, file bytes dan secret tidak di-cache. Mutation invalidates setelah commit; DB permission checks tetap otoritatif. Cache-only Redis outage tidak menjatuhkan readiness.

## 9. Upload dan storage

`POST /api/upload` menerima multipart `file`, default local private storage, optional S3/MinIO via env. Gunakan UploadedFile validation, MIME sniff/content check, max 10 MiB baseline, bounded streaming, generated object key dan filename sanitization. Local files berada di storage private, tidak diekspos oleh public symlink otomatis. Download by ID memeriksa permission/ownership/status READY dan menghasilkan streamed response dengan safe Content-Disposition.

S3 melalui Laravel Storage/Flysystem/AWS SDK, credential/region/endpoint/path-style typed configuration, request timeout dan bucket verification. Upload DB/audit failure melakukan compensation atau menyisakan orphan yang dikenali cleanup; storage write tidak diklaim atomic bersama SQL. Public metadata DTO tidak memuat absolute path/credential/internal storage key. Cleanup menjaga file referenced, fresh grace objects dan symlink/path boundaries.

## 10. Notifications, SMTP outbox dan worker

Notification creation locks recipient counter, allocates sequence, stores notification dan optional EmailJob dalam satu DB transaction dengan required audit. `sendEmail=false` → NOT_REQUESTED; SMTP enabled + requested → 201 PENDING; disabled + requested → FAILED tanpa job. Permission create adalah manage_notifications; list/read/stream hanya milik recipient. Current public fields mengikuti source DTO; internal sequence/recipient email/job payload tidak ditambahkan ke public response.

Worker command proposed `php artisan notifications:work`. Claim memakai native Laravel DB/query builder dengan SKIP LOCKED dan fenced leaseId. Native Mail facade mengirim setelah claim transaction selesai; worker SQL outbox ini memiliki state/lease contract explicit. Laravel `queue:work` bukan command untuk tabel EmailJob; dokumentasikan command yang benar di CLI dan Compose.

Default concurrency 2, polling 3s, lease60s/renew20s, SMTP timeout25s, max5 attempts, retry5/30/120/600s. Karena PHP request/command biasa synchronous, renewal tidak dapat diasumsikan terjadi ketika send blocking. Untuk portable worker gunakan supervisor command yang menjalankan maksimal dua child delivery processes dan memantau lease/renewal pada parent loop; child results mempunyai typed bounded IPC, tidak membawa secret di argv/log. Library Symfony Process yang tersedia melalui dependency graph dipakai untuk child lifecycle. Windows signal/termination behavior ditangani melalui portable process API, Linux SIGTERM untuk graceful stop. Prove renewal pada delivery >20s.

Parent claim/renew/completion memakai leaseId; child tidak mempunyai otoritas untuk menyelesaikan job yang telah kehilangan lease. Immutable recipient/title/body snapshot, unique job per notification; reclaim expired lease, exhausted abandoned fifth attempt FAILED, bukan attempt keenam. SMTP off worker idle/no-op tanpa polling DB. Shutdown stops claims, waits bounded children, then releases/recoverable leases sesuai fencing semantics. No SMTP call di DB transaction.

Laravel Mail/Symfony Mailer mendukung transport SMTP dengan STARTTLS/implicit TLS dan trusted CA; TLS verification/hostname check tidak dinonaktifkan. MAIL config dihasilkan dari typed SMTP settings; property names mengikuti framework release actual. SMTP at-least-once berarti crash setelah server accepted dapat menduplikasi delivery; retry tidak dijanjikan exactly-once.

## 11. SSE dan server PHP

Symfony StreamedResponse dibentuk setelah auth, registry/rate policy dan cursor validation selesai. Event ID UUID notification; internal recipient sequence menentukan urutan. Query batches 50, drain backlog sebelum polling3s, heartbeat15s. Tanpa cursor mulai seluruh unread; Last-Event-ID milik user mengirim seluruh sequence sesudah cursor termasuk notification yang sudah read. Unknown/foreign cursor 400 sebelum headers.

List mempertahankan array data; optional cursor dan next-cursor header mengikuti source baseline dan CORS exposed headers. Counter transaction/unique index mencegah duplicate order; tidak memakai timestamp/MAX tanpa lock.

- Lifetime min(14 menit, JWT expiry), stop ketika user inactive/cancel/disconnect/DB unavailable. Recognized database failure after headers menutup stream bersih dengan safe log.
- Set text/event-stream, no-cache, X-Accel-Buffering:no, dan flush terukur. Database session/transaction tidak ditahan selama network write/poll sleep.
- Nginx buffering/compression untuk stream dimatikan; proxy/FastCGI timeouts melebihi heartbeat/lifetime, client send timeout dan buffer budget tetap bounded.
- FPM connection budget explicit: proposed pm.max_children8, SSE_MAX_CONNECTIONS_PER_INSTANCE4, reservasi normal HTTP workers. Admission menggunakan bounded local flock slots yang dilepas finally; tidak menahan DB connection sebagai semaphore.
- Slow client/cancel diuji melalui HTTP langsung; EOF tidak menghasilkan broken chunked response. Cleanup listeners/timers/resources setelah generator keluar.
- Native manual `artisan serve` cocok untuk development terbatas; production SSE memakai configured Nginx+FPM. Kapasitas SSE diuji/diukur sesuai deployment, tidak disebut unlimited.

Octane/Reverb merupakan opsi architecture untuk kebutuhan selanjutnya; baseline ini menetapkan HTTP/FPM/SSE resource semantics yang dapat diverifikasi.

## 12. Cleanup, observability, readiness dan env

`php artisan backend:cleanup` default dry-run/batch500. Explicit `--apply` untuk delete. Retain active-family consumed hashes; ended/revoked families dan terminal outbox >30d dapat dibersihkan; pending/leased jobs dan persisted notifications dipertahankan. Orphan upload grace24h dan final DB reference recheck; local/S3 path/ownership validated. Audit deletion default false, activation requires flag+explicit retention, recommended365d. Cleanup supports concurrent processes dengan bounded transaction/claims; tidak dijalankan saat startup API.

Optional OTel SDK default off, explicit request/DB/Redis/storage/email/cleanup spans; request/error/duration, SSE/outbox/attempts/cleanup metrics, bounded operation IDs, request/trace correlation. Exporter timeout/buffer/flush budgets dibatasi. No bearer/password/email/body/SQL binding/private query/SMTP payload in logs/spans. Structured Monolog context scoped; worker clears request/trace/static state per job. OTel exporter failure tidak menjatuhkan request/readiness. Optional Collector profile, native transport mapping dan extension optional didokumentasikan.

`/live` tidak membuka DB/Redis. `/ready` checks SQL dan Redis bila quota distributed, bounded timeout; cache-only Redis, SMTP, storage/Collector optional tidak menjadi hard dependency. `/health` lightweight compatibility. Laravel provider boot/session/cache defaults tidak boleh membuat liveness bergantung pada DB; stateless API memakai guard bearer, tanpa web session middleware.

Typed config categories: APP_ENV/APP_NAME/APP_URL/APP_KEY; DB_PROVIDER/DB_*; JWT_*; ENDPOINT_POLICIES_JSON/CORS_ORIGINS/TRUST_PROXY; APP_INSTANCE_COUNT/rate groups/file-vs-Redis; optional cache/upload/S3/SMTP; worker concurrency/lease/retry; cleanup retention/apply; OTEL_*; FPM/SSE/resource settings. Env hanya dibaca pada config layer, bukan `env()` tersebar di service setelah config cached.

CLI generates random APP_KEY base64:32bytes dan distinct JWT secret, validates bool/integer/URL/groups/timezone/identifier. Laravel dotenv quoted credentials/JSON must round-trip; `"false"` tidak menjadi truthy karena cast PHP sembarang. Production rejects placeholder credential. Log/error menyebut nama setting saja.

Config cache tidak dibuat dengan deployment secrets ketika image build. Runtime entrypoint/config cache preparation terjadi setelah env injected, per-container private; perubahan env manual memerlukan config:clear dan restart HTTP/worker. `.env`, cached config, storage logs/uploads/cache, vendor, test fixtures dan secret/cert private tidak masuk package/Git.

## 13. Commands, generator dan containers

Command yang harus diimplementasikan dan tercermin pada README/CLI:

```powershell
composer install --no-interaction --prefer-dist
php artisan backend:initialize
php artisan backend:migrate --force
php artisan backend:seed
php artisan serve --host=127.0.0.1 --port=8000
php artisan notifications:work
php artisan backend:cleanup --dry-run
php artisan backend:cleanup --apply
php artisan make:backend-module Invoice
php artisan backend:verify-contract
php artisan backend:openapi-export
```

`backend:migrate` memakai native Migrator/migrate command dengan selected provider path, bukan migration implementation sendiri. Module generator extends native GeneratorCommand; DTO/FormRequest/Resource/service/model/policy/routes/registry IDs/migration draft concern scoped dihasilkan; filename/namespace/path/overwrite validated dan output strict dianalisis pada task testing. Seeder idempotent explicit; process HTTP dan worker tidak menjalankannya otomatis.

`backend:initialize` menyiapkan env/provider/port dan secret random dengan input validation yang sama dengan CLI, menolak overwrite `.env` existing, dan tidak melakukan migration/seed/install diam-diam. Config/DB validation yang membutuhkan env final tidak dijalankan sebelum command initializer dapat membuat env; provider boot dan Composer package discovery tidak membuka koneksi database.

Docker multi-stage Composer/php extension build dengan cache terpisah, PHP8.5 FPM runtime non-root, Nginx non-root listen8080, safe permissions dan writable private storage. Public default host **8000**, HTTP container port **8080** pada service **web**. Service **app** menjalankan FPM dan native console commands; SQL **migrate** job sekali jalan; **worker** command SQL notification outbox. App/worker menunggu migration success, web menunggu app readiness. Seed service profile explicit. Redis/S3/Collector optional; MySQL/PostgreSQL Compose separate, configurable host ports, override example dan no fixed container names.

Web/FPM topology harus dicatat sebagai descriptor CLI: httpService=web, applicationService=app, workerService=worker. Acceptance mengambil public port dari web dan menjalankan seed/cleanup dalam app, bukan menganggap semua framework mengekspos HTTP dari app. Nginx docroot hanya public/; .env/storage/vendor/framework config tidak dapat dibaca lewat HTTP. Composer package discovery/cache bootstrap tidak membutuhkan DB; backend config validation dilakukan pada runtime context yang relevan.

Referensi deployment: [Laravel production deployment](https://laravel.com/docs/13.x/deployment). README memuat manual Windows/Linux setup, required extensions, exact CLI commands, optional features, upgrade/release migration, cron cleanup, SMTP delivery semantics, SSE capacity, backup/restore boundaries dan troubleshooting.

## 14. Integrasi npm CLI dan koordinasi Spring

Template ID proposed `laravel`, port8000. Saat kedua framework aktif: tujuh framework × dua DB = **14 combinations**, **28 Windows/Linux consumer jobs**, **14 Compose jobs**, macOS smoke.

- Extend TemplateId/RuntimeRequirements/manifest parser untuk PHP version64-bit, Composer version/extensions; strict command/topology descriptors, no any/type assertion bypass.
- PHP/Composer manual preflight sebelum folder creation/install. Redis/OTel optional extensions tidak diwajibkan saat fitur off. Docker setup tidak membutuhkan PHP/Composer lokal.
- Composer install dari lock dan source payload; template tidak di-download lagi dari GitHub saat CLI generation. Initial skeleton creation memakai tooling resmi pada source repo.
- Windows Composer sering berupa .bat/PHAR; resolve actual PHAR+php atau verified platform adapter, dan POSIX executable. shell=false dengan nama batch tidak diasumsikan bekerja. Gunakan argument array, safe path resolution, secret via env dan isolated process cancellation.
- Project identity: Composer `vendor/name` valid (proposed app/<kebab-project>), APP_NAME/APP_URL/ports, JWT issuer/audience, Redis namespace/deployment name. Laravel namespace App tetap PSR-4 native; quote names with spaces safely.
- Renderer DB/env sets file quota default when Redis off, Redis distributed when selected. APP_KEY/JWT secrets distinct/random. Provider database credentials, Docker addresses, web/app topology dan worker/cleanup instructions konsisten.
- Explicit allowlist artisan, composer files, app/bootstrap/config/routes/database/public/resources/scripts/tests/docs/compose/examples/license. Exclude vendor, node_modules, .env, storage runtime/bootstrap cached config, compiled assets from local experiments, private cert/key/database dumps.
- Snapshot has clean commit/hash provenance for release; --allow-dirty is development only. New source/submodule remote exact and reachable.
- Update prepare snapshots, all args/help/wizard/runtime checks, scaffold provider/identity/defaults, manual/consumer/Compose adapter, hardening inventories/archive audits/workflows. Existing five templates tetap diperiksa.
- Shared CLI updates dikerjakan terkoordinasi: metadata Java wrapper dan HTTP topology Laravel tidak saling ditimpa. Tidak menurunkan lockfile atau menghapus template framework lain saat merge.

## 15. Tasks implementasi dan handoff review

- [x] L0 — Konfirmasi path/remote; recheck source/DTO/route status; document PHP-native validation profile dan expected wire contracts.
- [x] L1 — Bootstrap resmi Laravel, Composer lock/runtime/extensions, DEPENDENCIES/license/AGENTS/ignore, modular layout.
- [x] L2 — Typed configuration, UTC/provider/Eloquent relations, native migration histories, identifier validation, initializer dan seed idempotent.
- [x] L3 — Registry, routes/policies/guard, FormRequest/readonly DTO/Resources/error handlers, Users/Roles/Permissions, CORS/health/docs.
- [x] L4 — JWT15m/refresh sliding30d, family lock/replay/consumed logout dan transactional audit.
- [x] L5 — File/Redis atomic rate store, optional response cache, upload/storage/download, recipient counter/cursor/SSE and atomic notification outbox.
- [x] L6 — Worker parent/child lease renewal/fencing/retry/SMTP/graceful shutdown; retention/cleanup; safe OTel/logging/FPM resource lifecycle.
- [x] L7 — Artisan module generator, manual/run/deploy/upgrade docs, Composer image discovery, PHP-FPM/Nginx/Compose/override/profiles.
- [x] L8 — CLI preflight/env/identity/provider/ports/topology/snapshot/install integration; author full acceptance scripts and seven-framework matrix.
- [ ] L9 — Complete shared matrix checks and final root snapshots/release CI. Laravel native/build/consumer/runtime gates and all 14 Compose scenarios on each provider passed. Source main is pushed; corrected source CI 37101082690 passed all three jobs (Windows native, Linux native, full Docker build and both-provider integration) at code commit 34a14d59f5655587943967a39951f81f79a5926d. Current user authorization requires proceeding without another review pause.

Dependency install/metadata/codegen/format required to prepare source are recorded separately. Do not call preparation a passing test gate. Application spike needed for a compatibility decision is explicitly scoped with the user before running it if the testing gate has not been authorized.

## 16. Final task testing, setelah review

Author complete scripts, fixture ownership, assertions, failure collection, deadlines and finally cleanup for all tasks first. Run independent unit/build jobs with collected exit/error/log, continue remaining jobs, and return aggregate nonzero on real failure. Direct API dependent scenario may fail immediately. Classify related failures/root causes, repair as a group and rerun affected gates with bounded attempts; no infinite auto fix/retry loop and no false green via swallowed exit status.

| Gate | Acceptance |
| --- | --- |
| PHP/native | PHP64/extensions/Composer lock validation+audit, Larastan max/Pint/PHPUnit/native routing/cache/config checks on Windows/Linux |
| Models/schema | Real PostgreSQL/MySQL fresh + native pre-hardening upgrades, FK/collation/UUID/JSON/UTC/index/checksum, seed repeat, no SQLite substitution |
| Auth/RBAC | JWT15m/sliding30d/old consumed logout, replay revocation committed, expired/revoked not revived, coordinated concurrency, active lookup, privilege escalation |
| Audit | Required mutation rollback, optional fault commits (including PG aborted-transaction risk), unknown logout204 no audit, override capability rejection, snapshot redaction |
| HTTP/OpenAPI | 33 operations/security/DTO/status/envelopes/binary/SSE/next-cursor; actual Laravel422 profile, generated module strict contracts, docs schema field/status assertions |
| Rate/cache | FPM multiple-process local quota atomicity, two-replica Redis shared quota, failure paths, health on outage, authorization before cache/filter separation/invalidation |
| Storage | Local/S3 upload/download size/MIME/access/path/streaming, compensation after SQL/audit failure, private docroot and object reference checks |
| SSE | 51/120 backlog, ordered concurrent inserts, cursor recipient isolation/read items, before-header400, expiry/inactive/cancel/slow client/DB outage EOF, FPM admission preserves HTTP capacity |
| Worker | Two child workers, parent renewal while SMTP blocks >20s, immutable snapshots, off/failed/recovered SMTP/TLS, retry5 limits, lease expiry/fencing/restart/duplicate boundary, Windows/Linux graceful stop |
| Cleanup/OTel | Dry-run/batch/concurrent cleaner, active token traces/pending jobs/notifications, audit off/opt-in365d, upload grace/ref recheck; disabled/active/collector outage, all operation metrics/context/redaction |
| Generated/manual | Tarball npm exec/npm create -> install/type/build/config/docs/generator/manual HTTP for Laravel PG/MY and all existing combinations; paths/spaces/special credential quoting |
| Compose/distribution | 14 frameworks/provider stacks migrate+API+worker+explicit seed/live/ready+outages, 28 Windows/Linux consumers and macOS smoke, package checksums/private artifact exclusion |

Disposable Docker fixtures have unique project labels/ports; scripts always down volumes/orphans plus owned test image tags and verify cleanup. Parent suite only cleans its log-owned resources; no global prune and no removal of other tasks' fixtures. Keep diagnostic logs in TEMP outside npm source payload. Upgrade fixtures use isolated DBs and DB-admin fault injection, without increasing application DB privileges.

Evidence includes exact native/root commit, artifact checksum, commands/runtime versions, every matrix outcome and limits: slow-client/cancellation is not unlimited load proof; source final reference check is not a guaranteed filesystem+SQL distributed transaction; SMTP is at-least-once; production TLS/load/backup restore require deployment-specific verification. Commit/push/bump/npm publish follows user's release instruction after all gates pass. This planning request does not authorize publication.

## 17. Pertanyaan dan prompt agent

Pertanyaan untuk agent saat implementasi membutuhkan jawabannya:

1. **URL GitHub repo Laravel yang benar?** Required sebelum remote/submodule/push; source lokal dapat maju setelah implementasi diizinkan.
2. **Folder `template-JS/modular-laravel` sesuai?** Gunakan proposed default untuk routine choice sambil menyebut asumsi; jangan overwrite folder/repo existing.
3. **Dependency published release tidak kompatibel dengan Laravel13/PHP8.5?** Laporkan Composer constraint/actual error, lalu tanyakan bila alternatif membutuhkan perubahan major/runtime/public auth contract. Jangan fallback diam-diam ke opaque-token auth.
4. **Review implementasi selesai dan tahap testing boleh dimulai?** Required gate; gunakan otorisasi yang sudah eksplisit dalam sesi, jangan meminta ulang tanpa kebutuhan.
5. **Rilis commit/push/version/npm telah diinstruksikan?** Ikuti otorisasi aktual; planning saja tidak mengizinkan publish.

Prompt untuk chat implementasi:

> Implementasikan docs/LARAVEL-PHP-TEMPLATE-PLAN.md dari repo root template-JS. Baca AGENTS/source contracts dan source heads terbaru. Buat Laravel PHP modular monolith native dengan FormRequest, typed readonly DTO, Resources, policies, Eloquent, Artisan, SQL outbox worker, PostgreSQL/MySQL dan semua hardening baseline. Pasang package melalui tooling resmi dan periksa published compatibility/lockfiles. Tanyakan hanya informasi yang dibutuhkan seperti remote/path/blocking dependency sesuai daftar plan, sambil melanjutkan pekerjaan independen. Pertahankan env/data/migration/source existing. Koordinasikan shared CLI dengan plan Spring Boot, termasuk Windows Composer/Maven adapters dan Laravel web/app topology. Tulis seluruh implementasi serta script testing lengkap, handoff review, kemudian jalankan pengujian paling akhir setelah otorisasi. Collect independent failures, repair root causes as a group with bounded reruns, remove only owned Docker test containers/volumes, and report exact evidence/boundaries. Commit/push/npm publish hanya mengikuti instruksi rilis pengguna.
