# Rencana Lengkap Template Spring Boot Java

Tanggal: 3 Oktober 2026. Status: **implementasi, full build dan final testing lokal lulus; commit/push dan CI sedang diselesaikan**. Instruksi langsung pengguna mengizinkan seluruh testing, JDK/proses pendukung dan push main tanpa konfirmasi ulang.

Dokumen pasangan: [Laravel PHP](LARAVEL-PHP-TEMPLATE-PLAN.md). Baseline fitur: [hardening existing](BACKEND-HARDENING-ENHANCEMENT-PLAN.md), [handoff](BACKEND-HARDENING-REVIEW.md), dan [bukti pengujian](BACKEND-HARDENING-TEST-RESULTS.md).

## 1. Tujuan dan batas pekerjaan

Tambahkan Spring Boot sebagai pilihan Java pada `create-ridhuan-backend`. Proyek hasil generation berdiri sendiri, menggunakan PostgreSQL atau MySQL, dan mempunyai fitur setara dengan lima template existing beserta hardening terakhir.

- Arsitektur berupa modular monolith dengan package berdasarkan fitur dan komponen Spring native.
- Konfigurasi dynamic berarti env kemudian restart/redeployment.
- Redis, SMTP, S3 dan telemetry tetap opsional. Database utama wajib.
- PostgreSQL merupakan pilihan default. Provider dipilih ketika generation; pergantian provider tidak mengonversi data existing.
- Implementasi mencakup source, migration, generator modul, CLI, Docker, dokumentasi dan script acceptance lengkap.
- Testing menjadi task terakhir setelah implementasi dan full build tanpa test execution. Semua script satu tahap selesai ditulis sebelum tahap tersebut dijalankan; otorisasi testing sudah diberikan pengguna.
- Command `doctor`, SDK client, idempotency, verifikasi email/reset password dan multi-tenancy merupakan roadmap berikutnya dengan rencana tersendiri.

Target folder: `D:/Ridhuan Ngoding Moment/React/template-JS/modular-springboot`. Repo Git terpisah dengan remote yang diberikan pengguna: `https://github.com/RidhuanDEV/modular-springboot.git`. Integrasi submodule dilakukan setelah source commit/push; repo framework existing dipertahankan.

## 2. Baseline source dan kontrak

Source yang diperiksa saat perencanaan:

| Area | Source of truth |
| --- | --- |
| Endpoint/policy/response | Express `src/core/http/endpoint-registry.ts` pada `55198bb`; controller, DTO/schema dan service terkait |
| Hardening lintas framework | Source native lima template, khususnya transaksi refresh, notification counter, outbox, cleanup dan telemetry |
| CLI | `create-ridhuan-backend/src/{types,templates,arguments,process,instructions}.ts`, `src/scaffold`, `scripts/prepare-templates.mjs` |
| Acceptance | Script `verify-hardening*`, `verify-worker-retention`, `verify-compose`, consumer dan collecting runner |
| Root terbaru saat perencanaan | `b913b0e`; versi source CLI `1.4.0`, bukan pernyataan versi npm terbaru |

Registry Express saat ini mempunyai **33 operation**. Manifest kontrak lama masih dapat mengandung `sourceCommit` historis; implementasi harus menghasilkan manifest baru dari source/runtime yang sebenarnya. Template baru memakai UUID pada wire, field JSON camelCase, timestamp UTC ISO 8601, dan respons token `token` + `refreshToken` mengikuti baseline Express/NestJS. Envelope/success/error serta pagination diturunkan dari DTO dan helper source, bukan dari screenshot atau jumlah endpoint dalam README.

### Inventory minimum endpoint

Parameter `:id` pada source dinormalisasi menjadi `{id}` dalam OpenAPI. Registry menggunakan operation ID berikut.

| ID | Method dan path | Sukses |
| --- | --- | --- |
| health.get | GET /health | 200 |
| live.get | GET /live | 200 |
| ready.get | GET /ready | 200; dependency gagal 503 |
| docs.spec | GET /docs/openapi.json | 200 |
| docs.moduleSpec | GET /docs/specs/{module}.json | 200 |
| docs.ui | GET /docs | 200 |
| auth.register | POST /api/auth/register | 201 |
| auth.login | POST /api/auth/login | 200 |
| auth.refresh | POST /api/auth/refresh | 200 |
| auth.logout | POST /api/auth/logout | 204 |
| auth.me | GET /api/auth/me | 200 |
| user.list / user.get | GET /api/users; GET /api/users/{id} | 200 |
| user.create / user.update / user.delete | POST /api/users; PATCH /api/users/{id}; DELETE /api/users/{id} | 201 / 200 / 204 |
| role.list / role.get | GET /api/roles; GET /api/roles/{id} | 200 |
| role.create / role.update / role.delete | POST /api/roles; PATCH /api/roles/{id}; DELETE /api/roles/{id} | 201 / 200 / 204 |
| role.assignPermissions | POST /api/roles/{id}/permissions | 200 |
| permission.list / permission.get | GET /api/permissions; GET /api/permissions/{id} | 200 |
| permission.create / permission.update / permission.delete | POST /api/permissions; PATCH /api/permissions/{id}; DELETE /api/permissions/{id} | 201 / 200 / 204 |
| upload.create / upload.get | POST /api/upload; GET /api/upload/{id} | 201 / 200 |
| notification.create / notification.list | POST /api/notifications; GET /api/notifications | 201 / 200 |
| notification.read | PATCH /api/notifications/{id}/read | 200 |
| notification.stream | GET /api/notifications/stream | 200, text/event-stream |

Bare `/` bukan bagian dari kontrak wajib. Health test menggunakan route yang terdaftar. Spring infrastructure endpoints tambahan diinventarisasi dan dibatasi secara eksplisit.

## 3. Stack dan kebijakan dependency

Baseline perencanaan: **Java 25 LTS, Spring Boot 4.1.x, Maven Wrapper 3.9.x**, Spring MVC dan embedded Tomcat. Spring Boot 4.1.1 terverifikasi menerima Java sampai 26; Java 25 dipilih sebagai LTS. Angka patch, Maven distribution checksum dan image digest final diverifikasi kembali saat implementasi. Sumber: [requirements Spring](https://docs.spring.io/spring-boot/system-requirements.html), [Java roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html).

| Concern | Pilihan |
| --- | --- |
| HTTP/DI/config | Spring Boot, Spring MVC, configuration properties tervalidasi |
| Security | Spring Security, OAuth2 Resource Server JWT, Nimbus encoder/decoder yang didukung Spring |
| Password | Spring Security PasswordEncoder, bcrypt dengan batas input byte dan cost yang didokumentasikan |
| DTO | Java records, Jakarta Bean Validation, mapper eksplisit |
| JSON | Jackson sesuai Spring Boot BOM; verifikasi kompatibilitas Jackson 3 dan dependency pihak ketiga |
| Persistence | Spring Data JPA/Hibernate, HikariCP; JDBC/jdbc template untuk query locking/outbox yang perlu kontrol SQL |
| PostgreSQL / MySQL | Driver JDBC resmi masing-masing provider |
| Migration | Flyway core dan module database PostgreSQL/MySQL sesuai versi; satu migration owner |
| Redis | Spring Data Redis dengan Lettuce |
| Local quota/cache | Primitive concurrency JDK dan Caffeine dengan bounded capacity/TTL |
| File/S3 | Spring MultipartFile, AWS SDK Java v2 S3; MinIO melalui S3 compatibility |
| SMTP | Spring Mail / JavaMailSender |
| SSE | Spring MVC SseEmitter dengan lifecycle dan resource budget eksplisit |
| OpenAPI | springdoc-openapi 3.x, DTO validation dan operation metadata |
| Telemetry | Actuator/Micrometer dengan OpenTelemetry bridge/exporter resmi dan instrumentation yang kompatibel |
| Local dotenv | dotenv-java, dihubungkan ke Spring PropertySource secara teruji |
| Verification | JUnit Jupiter, Spring Boot Test, Spring Security Test, Testcontainers, Maven Surefire/Failsafe, formatter dan static analysis |

springdoc 3.x merupakan jalur untuk Spring Boot 4; [compatibility/library](https://springdoc.org/). Parser `.env` berasal dari [dotenv-java](https://github.com/cdimascio/dotenv-java); jangan memperlakukan `.env` sebagai Java properties tanpa memeriksa quoting. [Spring JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html), [Flyway PostgreSQL](https://documentation.red-gate.com/flyway/reference/database-driver-reference/postgresql-database), [Flyway MySQL](https://documentation.red-gate.com/flyway/reference/database-driver-reference/mysql).

Gunakan BOM, Maven Wrapper resmi dan pin versi plugin/library yang berada di luar BOM. Simpan `DEPENDENCIES.md` berisi publisher, lisensi, fungsi, compatibility dan evidence. Tidak menggunakan versi snapshot, mengimplementasikan crypto sendiri, atau mengganti library dengan stub. Pemilihan Hibernate/JDBC mengikuti kebutuhan fitur; jangan membuat generic repository tambahan yang sekadar membungkus Spring Data.

## 4. Struktur native

```text
modular-springboot/
  pom.xml
  mvnw, mvnw.cmd, .mvn/wrapper/
  .env.example, .env.mysql.example
  .gitignore, .dockerignore, .gitattributes
  Dockerfile, compose.yaml, compose.mysql.yaml
  compose.override.yaml.example
  README.md, AGENTS.md, DEPENDENCIES.md, LICENSE
  contracts/endpoints.json
  docs/{ARCHITECTURE,SETUP,DEPLOYMENT,UPGRADE,TESTING}.md
  scripts/{run.ps1,run.sh,otel-collector.yaml,...}
  src/main/java/com/example/backend/
    BackendApplication.java
    config/                    # validated config, provider, startup checks
    platform/
      endpoint/                # EndpointId, typed definitions, overrides
      security/                # JWT, principal, authorization adapters
      audit/                   # transactional audit + explicit snapshots
      cache/, ratelimit/, storage/, mail/, observability/
      jobs/                    # claim/lease infrastructure
      http/                    # envelopes, errors, request context
      time/                    # Clock, UTC serialization, zone utility
    auth/                      # controller, DTO, service, repositories/entities
    users/, roles/, permissions/
    uploads/
    notifications/             # recipient sequence, outbox producer, SSE
    operations/                # worker/migrate/seed/cleanup/generator commands
  src/main/resources/
    application.yaml
    application-postgresql.yaml, application-mysql.yaml
    db/migration/{postgresql,mysql}/
    templates/module/          # native source generator resources
  src/test/java/...            # unit, contract and provider integration
  src/test/resources/...      # upgrade/fault fixtures
```

Package feature mempunyai API service/DTO yang diperlukan; entity/repository implementation tetap di concern pemiliknya. Controller menangani HTTP dan validasi, service menangani authorization bisnis/transaksi, repository menangani persistence, DTO mapper menangani output. Hindari service global yang mengerjakan semua modul. Entity JPA tidak menjadi response HTTP.

JPA `open-in-view=false`; loading relasi dibuat eksplisit melalui projection/entity graph/query yang terukur. Transaksi melalui Spring proxy pada public application service; jangan mengandalkan self-invocation `@Transactional`. Audit membutuhkan transaction manager/DataSource yang sama. Retry transaksi tidak boleh mengulang SMTP/S3/HTTP external side effect.

## 5. Type safety, registry dan HTTP

- Java records untuk body/query/response, enum untuk audit/cache/rate/permission/endpoint ID, UUID/Instant/long untuk tipe domain terkait.
- Generic selalu mempunyai type parameter. Nullable boundary dijelaskan dan divalidasi; compiler/static analysis tidak ditutup dengan suppression massal.
- Dynamic JSON menggunakan DTO override atau JsonNode yang dinarrow. Audit memakai snapshot record yang eksplisit; jangan menyalin entity/raw request ke Map bebas.
- Seluruh controller dipetakan melalui `@EndpointPolicy(EndpointId.AUTH_LOGIN)` ke registry pusat. Path/method Spring MVC dibandingkan dengan definition ketika startup.
- Registry mencatat visibility, permission, audit mode, **audit capability**, cache, rate group, status, media type dan DTO.
- Override `ENDPOINT_POLICIES_JSON` hanya mengubah key yang didukung. Unknown ID/key/group, cache pada stream/mutation atau required audit tanpa producer ditolak sebelum menerima trafik.
- Audit mode `required|optional|none`; capability transaction/read/none menentukan validitas override. GET tanpa producer tidak dapat dipaksa required.
- `@ControllerAdvice` memetakan validation, conflict, not-found, unauthenticated, forbidden dan unavailable berdasarkan source baseline. Buat DTO error dan stabilkan machine-readable contract; response tidak membawa exception/SQL/secret.
- Request ID dibatasi panjang/karakternya; correlation tetap benar pada async SSE/worker, MDC dibersihkan ketika task selesai.
- Semua business routes tercatat di registry/rate limiter/OpenAPI. Actuator env/configprops/heapdump/shutdown tidak diekspos melalui public port; raw framework OpenAPI routes diarahkan/dibatasi agar tidak menjadi bypass policy.

## 6. Database, model dan waktu

Tiap proyek hasil generation memakai database sendiri. Database Spring tidak berbagi migration history/tables dengan template existing.

Model minimum: User, Role, Permission, RolePermission, ActivityLog, StoredFile, RefreshFamily, RefreshToken, NotificationCounter, Notification, EmailJob. Field, soft delete dan relation semantics dibandingkan dengan source baseline sebelum finalisasi DDL.

| Model/constraint | Ketentuan |
| --- | --- |
| User → Role | Required FK; penghapusan role yang masih dipakai ditolak; email unique sesuai normalisasi yang didokumentasikan |
| RolePermission | Composite PK/unique roleId+permissionId, FK strict dan policy cascade eksplisit |
| RefreshToken → RefreshFamily → User | Hash unique, FK/index family, expiry/revocation indexes, consumed token trace |
| NotificationCounter | PK recipientId; increment dengan row lock dalam transaksi create |
| Notification | UUID public, sequence BIGINT internal, unique recipientId+sequence, recipient/actor FK |
| EmailJob | Unique notificationId, immutable recipient/title/body, claim/retry/lease/completion fields dan indexes |
| ActivityLog | Actor snapshot, before/after JSON terfilter, endpoint/request IDs; actor FK nullable sesuai retention |
| StoredFile | Unique objectKey, provider/status/uploader metadata, filename/MIME/size tanpa expose filesystem path |

PostgreSQL menggunakan UUID, TIMESTAMPTZ dan JSONB yang sesuai. MySQL menggunakan UUID storage yang dipetakan eksplisit, DATETIME(6) UTC, JSON, InnoDB dan collation/length FK yang konsisten. Pilih CHAR(36) binary/ASCII sebagai default UUID MySQL yang mudah diinspeksi; codec binary UUID membutuhkan keputusan dan bukti terpisah. Gunakan signed BIGINT positif untuk sequence agar representasi Java long konsisten.

Hibernate `ddl-auto=validate`, tidak auto-create/update schema. Flyway mempunyai histories provider terpisah; checksum/ID migrasi yang sudah dirilis tidak diedit. Patch baru dibuat sebagai migration baru. Susun initial core + hardening migration berurutan bila dibutuhkan untuk fixture upgrade pre-hardening; fixture itu didokumentasikan sebagai schema native pra-rilis, bukan import dari database framework lain.

- Clock UTC diinjeksi; `Instant` menjadi sumber expiry/createdAt/updatedAt.
- JVM/container/JDBC/session DB disetel UTC. Verifikasi JDBC MySQL tidak menggeser waktu dua kali.
- Wire timestamp selalu ISO UTC; utility `ZoneId` menangani WIB/WITA/WIT dan zona luar negeri termasuk DST. Zona pengguna hanya mengubah presentasi.
- Validasi user/db name terpisah: PostgreSQL maksimum 63 byte ASCII; MySQL username 32 karakter dan database 64 karakter sesuai allowlist CLI existing.
- Seed eksplisit dan idempotent: permission concern `manage_users`, `manage_roles`, `manage_permissions`, `manage_uploads`, `manage_notifications`; role/admin baseline. Seed ulang tidak mereset password admin existing.

## 7. Auth dan RBAC

Access JWT **15 menit**; opaque refresh **sliding 30 hari tanpa absolute cap**. Gunakan issuer/audience/exp/algorithm allowlist dan claim token-use; HS256 dengan secret random memadai sebagai baseline existing. Token refresh minimal 32 random bytes, hanya hash SHA-256 yang disimpan. Password bcrypt cost/batas UTF-8 disamakan dengan kontrak yang diverifikasi.

Prosedur refresh:

1. Hash input dan temukan family ID. Token tidak diketahui → 401.
2. Mulai transaksi, lock family dengan SELECT FOR UPDATE/pessimistic write, lalu baca ulang token di dalam lock.
3. Tolak family revoked/expired dan user inactive. Token expired tidak diaktifkan kembali.
4. Replay token consumed mencabut family dan mencatat audit; commit revocation sebelum menghasilkan 401. Exception setelah rollback tidak boleh membatalkan pencabutan.
5. Rotasi valid mengonsumsi token lama, membuat hash token baru, dan memperpanjang family/token expiry UTC +30 hari dalam satu transaksi bersama required audit.

Logout `{refreshToken}` → 204 tanpa body; token unknown/already revoked tetap 204. Token sebelum rotasi tetap dapat mencabut seluruh family. Logout/refresh/replay mengunci family yang sama; jejak consumed token keluarga aktif dipertahankan walaupun expiry token lama sudah lewat. Unknown/no-mutation logout tidak membuat audit mutation palsu. JWT yang sudah terbit tetap hidup sampai expiry maksimum 15 menit.

Login user tidak diketahui tetap melakukan password verification dummy untuk mengurangi perbedaan timing. Login/refresh/logout/register memakai quota auth sebelum pekerjaan mahal. Principal hanya menyimpan identitas yang diperlukan; status user/otorisasi diperiksa dari source DB agar token tidak membawa hak stale. RBAC mencegah privilege escalation saat create/update user atau assign role permissions; manager tidak dapat memberikan hak yang tidak dimilikinya.

## 8. Audit dynamic dan caching/rate limiting

Audit snapshot berisi actor, module, behavior, entity, before/after dan server UTC time. Required audit ada di transaksi mutation. Optional audit menggunakan savepoint/transaction-safe strategy agar kegagalan insert PostgreSQL tidak membuat business transaction rollback-only; kegagalan logger tidak membocorkan parameter. Mode none tidak membuat record.

Authorization selesai sebelum response cache dibaca. Template cache example: user.list dengan filter/sort/page serta authorization scope yang dibentuk dari kontrak nyata. Cache Redis hanya bila enabled; outage menurunkan cache menjadi bypass. Jangan cache JWT/refresh/stream/upload bytes atau menaruh password/token/email di key/telemetry. TTL/batas payload jelas; invalidasi mutation setelah commit dan lintas replica bila Redis tersedia. Permission enforcement tetap membaca sumber otoritatif.

Rate groups default hanya auth/public/internal, fixed-window semantics dengan env window/max. Single JVM menggunakan state atomik dengan kapasitas/TTL terbatas. Redis menggunakan operasi/Lua atomik melalui Spring Data Redis, key namespace+group+identity. `APP_INSTANCE_COUNT>1` mewajibkan Redis rate store; auth fail-closed saat store gagal, public/internal fallback dengan safe log. Redis cache-only gagal tidak menggagalkan readiness. Group baru ditambahkan sebagai enum + env config/comment + registry assignment; registry tidak mempunyai endpoint tanpa group.

## 9. Upload, SMTP/outbox dan Notifications SSE

### Upload

`POST /api/upload` memakai multipart field `file`; download menggunakan ID lewat endpoint protected. Default local storage; `UPLOAD_ENABLED`, provider local/s3, max bytes dan MIME allowlist via env. MIME diperiksa dari konten; filename/path/object key dihasilkan server, cegah traversal/symlink/header injection. Default contoh 10 MiB mengikuti baseline source. AWS SDK resmi mengirim ke S3/MinIO dengan timeout, connection pool dan credential env; bucket wajib tersedia.

Storage write + DB/audit tidak dapat menjadi satu transaksi distributed. Catat state upload dan lakukan compensation bila DB/audit gagal; object yang tertinggal diproses cleanup dengan grace/ref check. File streaming menggunakan buffer terbatas; public DTO tidak memuat credential, local path atau object key internal. Download memeriksa akses dan metadata READY sebelum streaming.

### Email outbox

Notification, recipient sequence dan EmailJob committed dalam satu transaksi; create → 201 dengan emailStatus PENDING bila SMTP aktif dan email diminta. SMTP disabled + sendEmail=true menyimpan FAILED tanpa job. NOT_REQUESTED/SENT/FAILED mengikuti enum baseline.

Worker proses terpisah dengan Spring application non-web. Default concurrency 2, polling 3s, lease 60s/renewal 20s, SMTP budget 25s, max attempts 5 dan retry 5/30/120/600s. Claim menggunakan SKIP LOCKED, fencing leaseId, availableAt dan attempts dalam transaksi singkat. SMTP di luar transaksi; completion/renewal mensyaratkan leaseId yang masih dimiliki. Reclaim expired lease aman, abandoned fifth attempt menjadi FAILED, unique job per notification.

Snapshot recipient dan payload tidak berubah ketika akun/notifikasi diedit. SMTP uses TLS/hostname verification dan trusted CA; support STARTTLS serta implicit TLS. Shutdown berhenti claim, menunggu pekerjaan sesuai budget, dan tidak menandai delivery sukses tanpa confirmation. SMTP menyediakan at-least-once: crash setelah accepted dapat menyebabkan pengiriman ulang. SMTP disabled membuat worker idle/no-op tanpa polling DB terus-menerus.

### SSE dan pagination

- Ordered batch 50, drain seluruh backlog sebelum sleep polling 3s; heartbeat 15s.
- Tanpa cursor kirim semua unread bertahap; Last-Event-ID milik recipient mengirim seluruh item sesudah sequence tersebut, termasuk item read.
- UUID notification menjadi event ID; sequence internal. Cursor unknown/foreign → 400 sebelum headers.
- Counter increment terkunci dan insert transaction atomic; tidak memakai MAX(sequence) tanpa lock atau timestamp sebagai urutan.
- List mempertahankan array data existing; optional cursor/page-size dengan next-cursor header yang diturunkan dari source dan diekspos oleh CORS.
- Lifetime min(14 menit, expiry JWT); tutup saat user inactive, client cancel, atau DB unavailable setelah headers dengan EOF yang benar.
- SseEmitter memakai bounded scheduler/executor, cancel listener, write timeout dan batas koneksi. Query DB/transaksi selesai sebelum send; jangan menahan connection pool per client.
- Servlet SSE write dapat blocking; berikan resource budget dan slow-client timeout. Virtual threads boleh diaktifkan setelah bukti bahwa semaphore/pool/backlog tetap terbatas.

Referensi transport: [Spring MVC asynchronous requests](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-async.html). Pilihan async ini tidak otomatis membuktikan kapasitas production.

## 10. Cleanup, observability dan readiness

Cleanup command terpisah, default dry-run dan batch 500. Hapus family yang ended/revoked >30 hari beserta token terkait; active family tombstone dipertahankan. Outbox terminal >30 hari dapat dihapus; pending/leased jobs dan persisted notifications dipertahankan. Orphan local/S3 upload membutuhkan umur >24h, ownership/path validation dan reference lookup ulang sebelum delete. Lock/claim cleanup lintas proses dibatasi per batch. Audit deletion default false; aktivasi memerlukan flag dan retention eksplisit, default yang direkomendasikan 365 hari. Tidak dijalankan ketika API startup.

Telemetry default off. Pilih satu instrumentation owner; Spring/Micrometer bridge dan exporter OTel tidak dipasang bersama auto-agent yang menghasilkan span ganda. Trace HTTP/JDBC/Redis/storage/email/cleanup, bounded operation ID labels, HTTP/error/duration/SSE/outbox age+backlog/retry/cleanup metrics. Request ID/trace ID di structured logs, thread context async dipropagasi dan dibersihkan. Jangan export SQL parameter, raw SQL sensitif, URL query, bearer token, email, body atau exception message berisi credential. Collector gagal tidak memblokir HTTP/readiness; buffer/export timeout terbatas. Dokumentasikan pemetaan `OTEL_*` ke Spring native config dan transport gRPC/HTTP.

`/live` hanya memeriksa proses HTTP. `/ready` memeriksa DB dan Redis bila menjadi rate store, dengan timeout singkat, tanpa schema mutation. Redis cache-only/SMTP/S3/Collector optional tidak menurunkan readiness. `/health` compatibility ringan. Spring Actuator dikelola melalui konfigurasi endpoint exposure; jangan membuka env/heapdump untuk memenuhi parity health.

CORS origin exact allowlist via env; production wajib explicit, dev default frontend localhost. No-Origin diproses, credentials false default; rejected origin tidak memperoleh permissive header. Preflight dan next-cursor/request headers didokumentasikan. Trusted proxy hops/networks dibatasi, client IP tidak diambil dari forwarded header sembarang.

## 11. Config, command native dan containerization

Config typed memuat DB_PROVIDER/DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, JWT_*, CORS_ORIGINS, ENDPOINT_POLICIES_JSON, APP_INSTANCE_COUNT, rate groups, REDIS_*, CACHE_*, UPLOAD_*/S3_*, SMTP_*, worker defaults, CLEANUP_*, OTEL_*, APP_MODE dan port. Bool/string/number/URI divalidasi. JDBC URL dibentuk dari field terpisah; password tidak dirangkai ke JDBC URL/log.

Precedence: explicit CLI/process env → local dotenv → packaged defaults. `.env` local opsional bila seluruh env supplied. Invalid dotenv tidak diabaikan. Public errors menyebut nama setting, tidak menampilkan nilainya. Production menolak placeholder JWT/admin credential. Local env, upload, Maven cache dan build artifacts diabaikan Git/package.

Command yang harus benar-benar disediakan (nama final dipastikan konsisten pada README/CLI):

```powershell
# Windows; Maven Wrapper resmi, restore sebagai preparation
.\mvnw.cmd -B -DskipTests dependency:go-offline
.\mvnw.cmd -B -DskipTests package
java -jar target/app.jar --app.mode=migrate --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=seed --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=http
java -jar target/app.jar --app.mode=email-worker --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=cleanup --cleanup.dry-run=true --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=cleanup --cleanup.dry-run=false --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=initialize --spring.main.web-application-type=none
java -jar target/app.jar --app.mode=generate-module --module.name=Invoice --spring.main.web-application-type=none
```

Linux/macOS memakai `./mvnw`; artifact finalName `app` tetap stabil walaupun project/artifactId diganti. Command migration hanya mengaktifkan Flyway di mode migrate; HTTP/worker tidak auto migrate/seed. Generator/initialization offline context tidak mewajibkan koneksi DB. Native module generator membuat controller/DTO/service/entity/repository, registration/policy, migration draft dan permission concern; input package/path divalidasi, overwrite ditolak, source hasilnya diverifikasi pada task testing.

Mode initialize menghasilkan konfigurasi provider/port dan secret random sebelum runtime validation HTTP, menolak overwrite `.env` existing, dan tidak melakukan migration/seed/install diam-diam. Mode initialize/generate-module memakai application context terpisah tanpa DataSource/JPA/Redis auto-configuration; flag non-web saja tidak cukup untuk mencegah koneksi database. Lease renewal worker berjalan pada scheduler terpisah dari thread SMTP sehingga blocking delivery tidak menghentikan renewal.

Docker multi-stage JDK build → JRE non-root, port internal dan host default **8080**, writable upload directory, resource/graceful shutdown settings. Kedua provider Compose: DB → one-shot migrate → app dan worker; seed service profile explicit. Redis/S3/Collector profiles optional; override example mengganti host ports dengan variable yang didukung. Collector default optional. Tidak memakai fixed container name. App entrypoint hanya menjalankan role process. Migration gagal mencegah app/worker startup. Local env dan cache/build tidak ikut Docker context.

## 12. Integrasi CLI dan koordinasi Laravel

Template ID proposed `springboot`. Ketika Laravel selesai, `TemplateId` mencakup tujuh framework, menghasilkan **14 provider combinations**, **28 consumer OS jobs**, dan **14 Compose jobs**. Existing five tetap regression gates.

- Extend strict RuntimeRequirements untuk Java dan Maven wrapper metadata; validate manifest runtime termasuk fields baru pada `readManifest`.
- Descriptor port 8080, containerPort 8080, native command platform-specific; dependency restore menggunakan Maven Wrapper, tidak mengasumsikan Maven global.
- Java package namespace dipisahkan dari namespace .NET. Proposed default `com.example.<normalized-project>`; validate keyword/identifier/package path dan artifactId Maven terpisah.
- CLI preflight manual memeriksa JDK version dan wrapper requirements sebelum menulis folder. Docker mode tidak membutuhkan JDK/Maven lokal. `--no-install` hanya generation tanpa silent download.
- Windows wrapper `.cmd` memerlukan adapter yang teruji; shell=false tidak otomatis menjalankan batch file. Gunakan project launcher/platform resolver yang typed, constant argument arrays, dan validasi absolute target. Secret tetap di env, tidak di command line.
- Allowlist explicit untuk source/resources/pom/wrapper/scripts/tests/docs/compose/examples; exclude .env, target, .m2, logs, uploads, dump/keystore/private keys dan local fixtures.
- Rename package path/declarations/imports, artifactId/app identity/issuer/audience/Redis namespace/ports secara deterministik. Hindari replace teks global yang merusak SQL/docs/vendor URLs.
- Snapshot mempunyai commit/hash/dirty provenance. Dirty snapshot hanya development. Source remote/submodule asli diverifikasi sebelum snapshot release.
- Update args/wizard/help/requirements/env writer/manual/docker getting-started, dependency-check native, consumer/hardening runner, archive audit dan workflow.
- Jika plan Laravel dikerjakan terpisah, koordinasikan satu perubahan shared CLI schema/manifest. Jangan membuang TemplateId/requirement/adapter yang baru ditambahkan framework lain.

## 13. Tasks implementasi dan review

- [x] S0 — Konfirmasi folder/remote/package preference; catat actual source heads dan operation/DTO parity.
- [x] S1 — Bootstrap resmi Spring Initializr/Maven Wrapper, dependency matrix dan compatibility ledger; struktur, Git ignore, AGENTS, license/docs.
- [x] S2 — Typed env/provider/UTC, native entities/repos, provider migration histories, initializer dan idempotent seed.
- [x] S3 — Registry/security/public DTO/error/CORS/health/docs, Users/Roles/Permissions dan privilege boundaries.
- [x] S4 — 15m/sliding family auth, logout/replay, locking dan required/optional audit dengan transactional guarantees.
- [x] S5 — Optional caching/rate limiting, safe storage/upload/download, Notifications counter/cursor/SSE dan atomic outbox.
- [x] S6 — Separate worker, retry/fenced renewable leases, cleanup, telemetry/redaction, lifecycle/resource budgets.
- [x] S7 — Native module generator, manual/setup/deployment/upgrade docs, Docker/Compose/override/profiles.
- [x] S8 — CLI snapshot/install/preflight/identity/provider/ports integration; author all acceptance scripts and update seven-framework matrix.
- [x] S9 — Implementasi dan acceptance scripts tersedia. Instruksi langsung pengguna menggantikan handoff approval: lanjut full build, testing paling akhir, perbaikan, commit/push main dan CI tanpa konfirmasi ulang. Remote: https://github.com/RidhuanDEV/modular-springboot.git; package default com.example.<nama_proyek>.

- [x] S10 — Full build Java, CLI, Express terdampak dan image Java dengan test execution dinonaktifkan berhasil. Image build sementara dihapus; final testing dikumpulkan terpisah.
- [x] S11 — Final lokal: native7 gates/17 tests, manual19×2/Compose18×2 (74 scenario), lima pembanding SSE, Windows/Linux kedua provider, paket14 combinations, existing regressions dan audit PASS. Diagnostics OS TEMP, ownership isolation4/4; resource Docker pengujian bersih. CI matrix penuh diverifikasi pada S12.
- [ ] S12 — Commit/push source sebelum gitlinks/snapshot/root main; verifikasi remote HEAD dan semua CI yang terpicu. Tanpa version bump/npm publish.

## 14. Task testing terakhir, sesuai otorisasi pengguna

Selesaikan scripts inventory, fixtures, assertion, timeouts, collection dan cleanup untuk seluruh task sebelum execution. Independent unit/build jobs mengumpulkan exit/error/log lalu lanjut. Final aggregate nonzero bila ada failure atau cleanup failure; jangan menangkap error menjadi hasil pass. Direct API assertion dapat menghentikan scenario dependent. Grupkan error berdasarkan akar penyebab sebelum memperbaiki dan rerun affected gates; tidak ada auto retry/fix loop tanpa batas.

| Gate | Acceptance |
| --- | --- |
| Toolchain/native | Windows/Linux build/type/static checks, generic/nullability, formatter; dependency/vulnerability/license audit; no secret in artifact |
| Schema | PostgreSQL/MySQL fresh + native pre-hardening/upgrade fixture; old checksum unchanged; FK/index/UTC/DDL validation; seed repeat preserves admin password |
| Auth | 15m claims; sliding >120-day family creation, old expiry preserved; consumed logout/replay; concurrent refresh/logout/replay; inactive user; no revived sessions |
| Audit | Required insert fault rolls back mutation; optional fault still commits; committed replay revocation; unknown logout no fake audit; invalid override rejected |
| Registry/RBAC | All 33 operations and generator additions match DTO/security/OpenAPI; privilege escalation denied; no raw user/password/hash |
| SSE | 51/120 backlog, concurrent insertion, recipient isolation, cursor invalid before headers, reconnect/read items, expiry/inactive, slow/cancelled client, DB outage clean EOF |
| Cache/quota | Redis off/on/cache-only outage/multi-instance requirement, atomic quota across replicas, auth unavailable vs public/internal fallback, filter/scope cache separation |
| Upload | Local/S3, allowlist/size/sniff, streamed content, unauthorized/notfound, DB/audit failure compensation, filename/path/cleanup references |
| Worker | Atomic PENDING outbox; disabled SMTP; TLS/STARTTLS/implicit; snapshots; five attempts/retry/renewal; two workers; crash/lease expiry/fencing/duplicate accepted delivery; graceful shutdown |
| Cleanup/OTel | Dry-run/batches/concurrency/active families/pending jobs/24h grace/audit opt-in; labels/metrics/context/redaction/off/on/Collector unavailable |
| Manual/Compose | Artifact -> migrate -> explicit seed -> HTTP/worker; failed migration prevents app; live200/ready503 on DB outage; selected ports and both providers |
| CLI distribution | Tarball npm exec/npm create -> generation/install/build/module generator for all 14 combinations, 28 Windows/Linux consumers, macOS smoke, 14 complete Compose jobs |

Fixtures have unique project IDs, bind ephemeral ports, and store logs outside public sources. `finally` removes only owned containers/volumes/networks and owned test image tags; preserve unrelated stacks. Cleanup is verified with an isolation regression. Do not use global docker/system/volume prune. Preserve diagnostic logs, record interrupted/failed attempts as such, then bound reruns to the concrete repaired risk.

Release evidence identifies exact native/root commits, tarball checksum, versions, matrix, scenario boundaries and every remaining failure. Health/build/CI is not production load/TLS/backup restore proof. Pengguna telah mengizinkan commit/push main setelah seluruh gate lulus. Version bump dan npm publication memerlukan instruksi terpisah dan tidak dijalankan.

## 15. Pertanyaan dan prompt agent implementasi

Pertanyaan yang harus disampaikan saat implementasi memerlukan jawabannya:

1. **URL GitHub repo Spring Boot yang benar?** Required sebelum remote/submodule/push. Pekerjaan source lokal boleh maju setelah implementasi diizinkan.
2. **Folder `template-JS/modular-springboot` dan Java package default `com.example.<nama-proyek>` sesuai?** Default proposal boleh digunakan untuk keputusan rutin sambil mengumumkan asumsi; folder existing dibaca sebelum perubahan.
3. **Apakah versi baseline/library gagal compatibility gate?** Tunjukkan artifact/version/error aktual dan tanyakan keputusan bila membutuhkan pergantian major/runtime/arsitektur.
4. **Otorisasi testing final:** Sudah diberikan dalam instruksi pelaksanaan pengguna; tidak perlu konfirmasi ulang.
5. **Otorisasi rilis Git:** Commit/push main dan pemeriksaan CI sudah diberikan. Bump versi dan publish npm tidak diizinkan oleh instruksi tersebut.

Prompt yang dapat dipakai di chat implementasi:

> Implementasikan docs/SPRING-BOOT-JAVA-TEMPLATE-PLAN.md pada repo root template-JS. Baca AGENTS, source contracts dan source heads terbaru terlebih dahulu. Buat Spring Boot Java modular monolith dengan strict DTO/enum/contracts, PostgreSQL/MySQL dan seluruh fitur hardening setara template existing. Gunakan library native resmi/maintainer yang tercatat; verifikasi compatibility dan install melalui tooling resmi. Tanyakan informasi blocking yang belum tersedia sambil melanjutkan pekerjaan independen. Pertahankan semua source/migration/secret lokal existing dan koordinasikan shared CLI dengan Laravel. Selesaikan implementasi dan seluruh script pengujian, lalu full build tanpa test execution sebelum testing final. Collect independent errors, perbaiki kelompok akar masalah secara terukur, bersihkan dan verifikasi resource Docker milik pengujian. Setelah seluruh gate lulus, commit/push main source sebelum root gitlinks/snapshot, pantau CI dan verifikasi remote HEAD. Jangan bump versi atau publish npm.
