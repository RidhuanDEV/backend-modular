# Rencana template backend production NestJS

Tanggal rencana: 29 September 2026. Status: **implementasi berlangsung; gate lokal build, Prisma validate, 33 operasi OpenAPI, 7 test tanpa layanan, 6 test PostgreSQL, dan uji upgrade migration lulus. Empat endpoint Notifications memakai PostgreSQL, SSE, dan SMTP opsional. Redis/MinIO dan Compose CI belum dijalankan. Docker lokal terhambat kesalahan I/O storage daemon.**

Keputusan implementasi: refaktor folder `template-JS/nestjs`; kontrak mengikuti Express terbaru dengan 29 endpoint termasuk logout dan respons `token` + `refreshToken`; SMTP/SSE dipertahankan sebagai provider opsional; repo terpisah memakai `https://github.com/RidhuanDEV/modular-nestjs.git`; CLI yang sudah ada `create-ridhuan-backend` mendapat pilihan NestJS. Keputusan migrasi data MySQL lama masih menunggu jawaban pengguna; database lama tidak diubah.

Catatan implementasi rate limit: `RateLimitService` kecil dengan operasi Redis Lua atomik dipilih karena guard harus membatasi login sebelum validasi DTO dan memiliki kebijakan kegagalan berbeda untuk auth/public/internal. Dependensi `@nestjs/throttler` dihapus karena tidak dipakai.

## 1. Tujuan dan batas pekerjaan

Buat template backend NestJS berbentuk **modular monolith** yang mudah dipakai ulang untuk proyek baru. Kemampuan fungsional mengikuti keluarga template Express dan Go: auth, RBAC, CRUD user/role/permission, audit, upload lokal/S3, Redis cache opsional, rate limit, waktu yang konsisten, OpenAPI otomatis, health probes, Compose, initializer, dan CI. Struktur kode mengikuti module/provider/guard/pipe/interceptor/exception filter NestJS; jangan memindahkan susunan package Go atau middleware Express secara mekanis.

Lokasi awal adalah `template-JS/nestjs`. Folder ini sudah berisi prototipe NestJS, tetapi belum merupakan baseline kontrak yang disetujui. Baca source dan pertahankan pekerjaan lokal sebelum mengubahnya. Pada saat rencana ditulis, folder tersebut memakai Prisma MySQL, Compose MySQL, prefix `/api/v1`, `POST /auth/me`, refresh JWT stateless, dan audit best effort; hal-hal itu perlu ditinjau terhadap kontrak terbaru. Folder `modular-express-typescript-starter-postgre` sedang memiliki perubahan lokal pada `package.json` dan `src/config/redis.ts`; agent tidak boleh menimpanya saat mengambil snapshot kontrak. Repo Go berada di `template-JS/modular-golang`, dengan database terpisah.

**Aturan sumber kebenaran:** baca registry/DTO/schema/handler/service/migration yang sedang berlaku pada Express dan Go. Snapshot `contracts/express-endpoints.json` di Go bertanggal 24 September 2026 dan tidak otomatis mewakili Express hari ini. Bila kedua backend berbeda, catat perbedaan, tentukan kontrak NestJS secara eksplisit bersama pengguna, lalu pin fixture asalnya. Jangan menyalin perilaku yang salah hanya demi parity.

**Makna dinamis:** default policy didefinisikan dalam kode bertipe; override terbatas di environment saat startup, lalu aplikasi di-redeploy. Tidak ada panel admin atau reload policy runtime.

## 2. Keputusan stack dan dependensi

| Kebutuhan | Pilihan rencana | Catatan implementasi |
| --- | --- | --- |
| Runtime/HTTP | Node.js LTS, NestJS stable, `@nestjs/platform-express` | Pin versi kompatibel saat implementasi. Express adapter cocok untuk Multer dan kontrak HTTP yang ada. |
| Bahasa | TypeScript strict | Aktifkan `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, pemeriksaan lint/import; `unknown` dipersempit di boundary. |
| Database | PostgreSQL, Prisma ORM, `@prisma/adapter-pg` | Prisma sebagai satu-satunya pemilik migration NestJS. Pilih database sendiri, tanpa berbagi schema atau migration dengan template lain. |
| Konfigurasi | `@nestjs/config` + class env dengan `class-validator`/`class-transformer` | Gunakan fungsi `validate` saat bootstrap; environment deploy mengalahkan `.env` lokal. Jangan sebar `process.env` ke service bisnis. |
| DTO/validasi/docs | Class DTO, `class-validator`, `class-transformer`, `ValidationPipe`, `@nestjs/swagger` CLI plugin | DTO request menjadi sumber validasi runtime dan skema docs; response DTO eksplisit. Plugin mengurangi anotasi manual; tidak memakai JSDoc sebagai sumber kontrak. |
| Auth | `@nestjs/jwt` atau library JWT yang didukung Nest, bcrypt | JWT access 15 menit; refresh token opaque acak 30 hari, hash di PostgreSQL, rotasi satu kali pakai. |
| Rate limit | `@nestjs/throttler` untuk satu instance; adapter storage Redis yang diverifikasi atau implementasi atomik kecil | Tiga group default `auth`, `public`, `internal`; Redis wajib bila `APP_INSTANCE_COUNT>1`. |
| Cache | Provider Redis opt-in | Tidak menghubungkan Redis jika cache dan limiter Redis sama-sama off. Kegagalan cache jatuh kembali ke DB. |
| Upload | Nest `FileInterceptor('file')`/Multer; AWS SDK S3 resmi | Adapter lokal dan S3 kompatibel MinIO, tanpa mengikat service bisnis ke Multer/AWS SDK. |
| Logging/telemetry | Nest Logger atau adapter JSON terstruktur; OpenTelemetry opsional | Request ID, endpoint ID, trace context, redaction; jangan log token atau rahasia. |
| Pengujian | `@nestjs/testing` + runner yang kompatibel, Supertest, layanan disposable | Pin satu runner saja; uji DB/Redis/MinIO nyata di CI. |

**Zod tidak digunakan dalam rencana ini**, termasuk untuk DTO dan validasi `.env`. DTO request memakai decorator `class-validator`, transformasi yang diperlukan memakai `class-transformer`, lalu `ValidationPipe` NestJS menolak field asing. Env memakai class validasi tersendiri melalui `ConfigModule.forRoot({ validate })`; config yang lolos diteruskan sebagai provider bertipe.

Versi major, status dukungan, adapter Prisma dan generator output harus diperiksa tepat sebelum implementasi. Panduan Prisma/Nest saat ini menekankan driver adapter pada Prisma 7 dan `moduleFormat` eksplisit agar output client selaras dengan CommonJS/ESM. Pilih **satu** format module untuk aplikasi, Prisma Client, tooling, dan Docker; buktikan build serta startup dari `dist`. Jangan menganggap versi paket pada prototipe lama otomatis kompatibel.

Gunakan package resmi Nest bila menyediakan kemampuan yang diperlukan. Tambahan library harus punya alasan fungsi, publisher, versi, lisensi, dan batas kegagalannya. Hindari generic repository, CQRS/event bus, AutoMapper, request scoped provider global, atau lapisan interface untuk setiap class tanpa kebutuhan konkret.

## 3. Struktur proyek yang dituju

```text
nestjs/
  src/
    main.ts                     # bootstrap, global prefix, CORS, shutdown hooks
    app.module.ts               # composition root dan import module
    config/
      app-config.module.ts
      env.validation.ts            # class-validator/class-transformer
      endpoint-policy.config.ts
    platform/
      database/                 # PrismaModule, PrismaService, transaction helper
      redis/                    # koneksi opsional dan lifecycle
      logger/                   # structured logger dan request context
      storage/                  # token StoragePort, local/S3 adapter
      time/                     # UTC, IANA zone, business date
      observability/            # metrics/tracing opsional
    common/
      endpoint/                 # EndpointId, registry, @Endpoint(), policy resolver
      auth/                     # guard JWT/public metadata, current actor
      rate-limit/               # pre-auth dan per-user limiter
      audit/                    # audit policy, snapshot/redaction, writer
      cache/                    # cache interceptor/service, typed keys
      http/                     # envelope, exception filter, request ID
      dto/                      # pagination/error/system contract bersama
    modules/
      system/                   # /health, /live, /ready
      docs/                     # /docs, full dan module OpenAPI
      auth/                     # controller, service, dto, persistence helpers
      users/                    # controller, service, dto, mapper/query
      roles/
      permissions/
      uploads/                 # controller, service, dto, cleanup support
  prisma/
    schema.prisma               # PostgreSQL model dan relasi
    migrations/                 # riwayat SQL yang dimiliki NestJS
    seed.ts
  scripts/
    generate-feature.ts         # scaffold minimal dan idempotent
    cleanup-orphan-uploads.ts
    export-openapi.ts
    verify-template.ts
  contracts/                    # fixture parity + asal versi sumber
  test/                         # unit, integration, HTTP/e2e, contracts
  docs/                         # guide, runbook, keputusan arsitektur
  .github/workflows/ci.yml
  Dockerfile
  compose.yaml
  compose.override.yaml.example
  .env.example
```

Setiap feature module memiliki controller tipis, provider use case, DTO request/response, mapper eksplisit, dan akses persistence secukupnya. `PrismaService` dapat diinjeksi langsung ke service bila penggunaan sederhana; buat query/repository provider khusus ketika logika query kompleks atau dipakai ulang. Module mengekspor hanya provider yang benar-benar dipakai module lain; hindari `@Global()` pada seluruh `AppModule`. Dependensi lintas fitur melalui export module/port kecil, tanpa circular dependency atau `forwardRef()` sebagai solusi default.

Gunakan singleton provider untuk layanan tanpa state request. Context actor/request ID diteruskan secara bertipe ke use case yang membutuhkan audit; bila memakai AsyncLocalStorage, dokumentasikan ownership dan uji propagasinya. Semua I/O async diberi timeout/cancellation yang sesuai operasi; koneksi DB/Redis ditutup saat shutdown.

## 4. Kontrak API dan matriks parity

Target yang disetujui adalah **29 endpoint** Express terkini, termasuk `POST /api/auth/refresh` dan `POST /api/auth/logout`. Go masih memiliki 28 endpoint pada snapshot yang diperiksa.

| Modul | Endpoint target |
| --- | --- |
| System/docs | `GET /health`, `/live`, `/ready`, `/docs`, `/docs/openapi.json`, `/docs/specs/{module}.json` |
| Auth | `POST /api/auth/register`, `/login`, `/refresh`, `/logout`; `GET /api/auth/me` |
| Users | `GET /api/users`, `GET /api/users/{id}`, `POST /api/users`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}` |
| Roles | `GET /api/roles`, `GET /api/roles/{id}`, `POST /api/roles`, `PATCH /api/roles/{id}`, `DELETE /api/roles/{id}`, `POST /api/roles/{id}/permissions` |
| Permissions | `GET /api/permissions`, `GET /api/permissions/{id}`, `POST /api/permissions`, `PATCH /api/permissions/{id}`, `DELETE /api/permissions/{id}` |
| Uploads | `POST /api/upload` multipart field `file`; `GET /api/upload/{id}` metadata |

- Base path `/api` untuk feature dan root path untuk health/docs. Jangan memakai prefix `/api/v1` yang mengubah URL sebelum pengguna menyetujui perubahan versi API.
- Success mengikuti `{"success":true,"data":...}`; list menambah `meta` pagination. Failure mengikuti `{"success":false,"message":"...","errors":[]}`. Delete 204 tanpa body. Status/error lain diselaraskan per fixture yang diverifikasi.
- `UserResponseDto`/`AuthUserResponseDto` hanya memuat field publik yang eksplisit. Jangan serialisasi Prisma model, hash, `deletedAt`, token hash, atau relasi mentah. Projection `fields` memakai allowlist dan tidak melemahkan filter akses.
- Pertahankan query list (`page`, `limit`, `sortBy`, `orderBy`, `search`, `fields`) sesuai DTO yang sedang berlaku; pagination dan sort deterministik. Parameter sort/filter tidak boleh langsung menjadi SQL mentah.
- Bandingkan juga request validation, nullability, nesting role/permission, permission string, status, envelope, timestamp, multipart, dan error, bukan hanya method/path.
- Perubahan yang disengaja karena keamanan atau perilaku NestJS dicatat sebagai divergence dengan alasan serta test. Fixture baru harus berasal dari source yang diverifikasi, bukan dibuat agar test lulus.

## 5. Endpoint registry dan policy dinamis

Definisikan union `EndpointId` dan registry immutable bertipe: `method`, `path`, `module`, `summary`, `access`/permission, `audit`, `rateGroup`, `cache`, `status`, request DTO, response DTO. Setiap action controller memakai decorator seperti `@Endpoint('auth.login')`; decorator meletakkan metadata ID, sementara Nest tetap memiliki `@Controller()` dan method decorator untuk routing. `Reflector` dipakai guard/interceptor untuk membaca policy efektif.

Pada bootstrap/CI, validasi satu-ke-satu antara endpoint registry, action controller yang terpasang, dan OpenAPI paths/operations: ID unik, method/path unik, route tanpa registry ditolak (kecuali handler internal yang didaftarkan eksplisit), registry tanpa route ditolak, permission valid, status/DTO docs ada. Normalisasi `{id}` vs `:id`, global prefix, dan method HEAD/OPTIONS otomatis harus eksplisit; jangan bergantung pada nama class/method sebagai ID.

`ENDPOINT_POLICIES_JSON` hanya dapat override `audit: required|optional|none`, `rateLimit: auth|public|internal`, dan `cache: read|off` pada ID yang dikenal. Tolak property/ID/nilai asing dan kombinasi ilegal saat startup. `cache=read` hanya GET. `audit=required` pada GET hanya dapat aktif jika producer audit benar-benar menjamin write pada cache hit maupun miss; bila tidak ada, tolak konfigurasi. Env group limit tetap tiga default; group baru memerlukan tipe, env keys, registry assignment, dan pemeriksaan CI.

Contoh pemakaian controller/service yang dituju:

```ts
@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly policy: EndpointPolicyService,
  ) {}

  @Post()
  @Endpoint('user.create')
  async create(@Body() dto: CreateUserDto, @CurrentActor() actor: Actor): Promise<SuccessDto<UserResponseDto>> {
    const user = await this.usersService.create({ dto, actor, policy: this.policy.for('user.create') });
    return success(toUserResponse(user));
  }
}
```

`UsersService.create` menerima input bertipe dan policy efektif. Untuk audit `required`, service menyimpan mutasi dan audit dalam **transaksi Prisma yang sama**. Untuk `optional`, audit dilakukan setelah commit dengan timeout/logging terukur. `none` tidak menulis audit. Interceptor boleh mengatur metadata/request lifecycle, tetapi tidak boleh mengklaim atomisitas audit mutasi yang terjadi di service.

## 6. Auth, RBAC, dan data model

- Access JWT default 15 menit; validasi algoritma, signature, issuer, audience, expiry, dan `tokenUse=access` secara eksplisit. Tidak terima refresh token pada protected endpoint. Perubahan secret/claim diperlakukan sebagai perubahan sesi dan didokumentasikan.
- Refresh token berupa nilai acak kriptografis, hanya hash yang disimpan di PostgreSQL. Rotasi atomik satu kali pakai di transaction; token lama/replay membatalkan family. Tetapkan absolute family TTL default 30 hari tanpa memperpanjang tanpa batas. User nonaktif/soft deleted ditolak. Audit sesuai registry, tanpa merekam token mentah.
- Login/register/refresh dibatasi group `auth` sebelum operasi mahal. Password disimpan dengan hash adaptif, batas panjang dan canonical email jelas. Login gagal tidak membocorkan keberadaan akun.
- Auth guard memuat user/role aktif dari DB; permission guard memeriksa grant terkini. Jangan menjadikan claim permission sebagai otoritas jangka panjang. Public route harus dideklarasikan eksplisit; default action terlindungi.
- Prisma model minimum: `User`, `Role`, `Permission`, `RolePermission`, `ActivityLog`, `StoredFile`, `RefreshToken`. UUID, unique constraint, FK/onDelete, index, nullability, soft delete, dan `timestamptz(3)` dipilih secara eksplisit. Audit actor snapshot bertahan saat user dihapus.
- Satu database PostgreSQL NestJS dengan riwayat migration sendiri. `prisma migrate dev` untuk membuat migration di development; `prisma migrate deploy` menjadi **job rilis tunggal**, bukan langkah pada setiap replica. Seed admin/role/permission idempotent tetapi eksplisit dan tidak berjalan otomatis saat startup.
- Uji fresh migration dan upgrade migration dari data lama yang dibuat dengan versi pertama NestJS. Jika prototipe MySQL memiliki data nyata yang perlu dipertahankan, minta keputusan migrasi data sebelum mengganti provider.

## 7. Audit, cache, rate limit, dan upload

**Audit.** Simpan actor/user snapshot, module, behavior, entity ID, endpoint ID, request ID, before/after JSONB, dan created UTC. Snapshot dibuat dari field allowlist, bukan serialisasi entity Prisma; redaksi rahasia menjadi lapisan kedua. `required` rollback bersama mutasi saat audit gagal; `optional` mencatat kegagalan tanpa membatalkan mutasi; `none` tidak menulis. Hindari audit otomatis yang menulis sebelum transaksi bisnis selesai.

**Rate limit.** Terapkan public IP quota pada request API dan quota auth tambahan pada register/login/refresh. Setelah auth, internal quota memakai user ID; urutan guard harus ditulis dan diuji agar login benar-benar dilindungi sebelum handler. Health probes dikecualikan dari kuota. Proxy trust memakai hop/known proxy yang dikonfigurasi, tidak `trust proxy=true` tanpa batas. Memory store hanya untuk satu instance; Redis distributed store memakai operasi atomik dan key namespaced. Jika Redis limiter gagal, auth fail closed 503; public/internal fail open dengan log/metric, sesuai kebijakan keluarga template. Readiness gagal bila limiter Redis wajib tidak tersedia.

**Cache.** `CACHE_ENABLED=false` default. Cache read di endpoint yang ditandai registry (contoh: `user.get` dan `upload.get`), menggunakan DTO publik yang sudah tervalidasi, TTL/prefix versi, key mencakup query serta konteks otorisasi yang relevan. Jangan cache password, token, atau keputusan permission. Invalidasi setelah commit; lintas replica memakai strategi version key yang atomik. Cache-only Redis outage menjadi miss/fallback DB dan tidak menjatuhkan readiness.

**Upload.** `UPLOAD_ENABLED`, `UPLOAD_STORAGE=local|s3`, direktori lokal, size/MIME allowlist, dan S3 endpoint/region/bucket/credential melalui env. Terima multipart `file`; validasi jumlah byte sebenarnya, signature PNG/JPEG/PDF, file name/path traversal, symlink, dan random object key. Simpan object lalu metadata+required audit dalam transaksi; kegagalan DB memicu kompensasi delete. Tool orphan cleanup default dry run, `--apply` eksplisit, grace period, dan cek referensi DB. Tidak membuat route download publik sebagai default. Profile MinIO di Compose untuk uji S3 sungguhan.

## 8. Waktu, konfigurasi, docs, dan observability

- PostgreSQL menyimpan instant `timestamptz(3)`; JSON mengirim RFC3339/ISO UTC. Input instant harus menyertakan `Z` atau offset. Tampilan WIB/WITA/WIT serta zona luar negeri dihitung dari IANA timezone pada boundary response/presentation, tanpa menambah jam manual pada data DB. Business date memakai `date` yang terpisah dari instant.
- Env schema memvalidasi port, database URL, JWT secret, CORS origins, Redis mode, instance count, storage, ukuran upload, proxy, dan policy JSON. Production wajib CORS origins eksplisit; request tanpa `Origin` tetap diproses; credentials cross-origin default off. Nilai secret tidak muncul di error/log.
- `/live` hanya membuktikan proses HTTP hidup. `/ready` memeriksa PostgreSQL dan Redis bila dipakai untuk rate limit; cache Redis opsional tidak menggagalkan readiness. `/health` tetap respons ringan untuk kompatibilitas.
- `@nestjs/swagger` menghasilkan `/docs/openapi.json` dari controller/DTO nyata dan `/docs` UI; spesifikasi per modul memakai filter module/tag yang diverifikasi. Integrasikan Swagger CLI plugin untuk mengurangi `@ApiProperty`, tetapi tetap definisikan response/envelope, auth, multipart, error status secara jelas. CI mengekspor spec dan membandingkan operation/DTO dengan registry, tanpa JSDoc atau daftar endpoint manual kedua.
- Structured access log membawa request ID, endpoint ID, actor ID bila ada, status, durasi, dan trace ID. `@nestjs/terminus` boleh dipakai untuk readiness jika output-nya dapat dipetakan ke envelope kontrak; jika tidak, provider health kecil lebih jelas. OpenTelemetry/OTLP opsional, disable tanpa export background.

## 9. Container, initializer, dan pengalaman proyek baru

- Docker multi-stage dengan user non-root dan image/version terpin; build menjalankan Prisma generate, TypeScript compile, lalu runtime membawa artifact serta dependency yang perlu. Verifikasi startup image pada Linux.
- Compose default `app + postgres`, dengan one-shot `migrate` yang wajib sukses sebelum app. Redis dan MinIO memakai profile opsional; volume PostgreSQL/upload persisten. `compose.override.yaml.example` memperlihatkan host port overrides tanpa memaksa port produksi. Seed terpisah.
- Mode manual harus jelas: `npm ci`, konfigurasi `.env`, `prisma generate`, `prisma migrate deploy`, seed eksplisit, `npm run start:dev`/`start:prod`. Kebutuhan layanan yang off tidak boleh menggagalkan startup.
- Scaffold feature baru menggunakan Nest CLI atau script kecil untuk membuat module/controller/service/DTO/policy entry secara aman. Generator tidak boleh membuat endpoint kosong yang seolah siap produksi; ia menambahkan TODO kontrak bisnis dan menolak overwrite. Uji bahwa module baru terdaftar, registry/docs selaras, dan generated code build.
- Inisialisasi proyek baru dapat memakai paket `create-*` berbasis snapshot setelah template stabil. Jangan publish nama paket atau membuat repo remote sebelum pengguna memilih nama/distribusi; sediakan dry run/`--no-install`, secret acak, dan pengecekan paket agar `.env`, log, upload, generated files, dan kredensial tidak ikut rilis.
- Bila queue/background job dari template Express ternyata termasuk kontrak yang ingin dipertahankan, tambahkan `JobsModule` opt-in dengan Redis, retry/idempotency dan worker terpisah; jangan membuat dependency Redis wajib bagi API dasar. Minta konfirmasi karena template Go saat ini tidak memiliki endpoint queue publik yang setara.
- README publik berisi quick start Compose/manual, contoh register-login-refresh-me-upload, env table, arsitektur, custom module, runbook migration/backup/restore, batas kesiapan production, dan tautan docs.

## 10. Urutan implementasi

1. **Audit baseline dan keputusan:** inventaris folder NestJS, status Git, perubahan lokal, kontrak Express/Go aktual, migration/data MySQL, dependency compatibility. Sajikan gap matrix dan ajukan pertanyaan pada §12.
2. **Fondasi NestJS:** tetapkan format module, versi, config validator, Prisma PostgreSQL adapter, database module, lifecycle, strict TS, response/error filter, request ID, CORS, health.
3. **Kontrak dan registry:** freeze fixture yang disepakati, typed IDs/default policies, decorator `@Endpoint`, startup validator, OpenAPI generator/check.
4. **Model dan migration:** buat schema PostgreSQL serta migration awal, seed eksplisit, upgrade path, index/constraint/transaction helper.
5. **Feature inti:** auth+refresh/RBAC, user/role/permission CRUD, DTO publik, pagination, audit transaksi.
6. **Infra opsional:** rate limit memory/Redis, cache Redis, upload lokal/S3, orphan cleanup, waktu/IANA, telemetry.
7. **Operasi:** Docker/Compose/migration job, initializer/scaffold, dokumentasi publik, CI dan dependency scan.
8. **Acceptance:** jalankan test matrix, review keamanan/kontrak, catat bukti serta batasnya. Commit/push/publish/deploy hanya setelah ada instruksi eksplisit pengguna.

## 11. Gate dan kriteria penerimaan

| Gate | Bukti yang diminta |
| --- | --- |
| Build/type/dependency | `npm ci`, Prisma validate/generate, lint/format check, `tsc --noEmit`, Nest build, dependency/audit scan tanpa secret. |
| Kontrak | Seluruh endpoint registry terpasang tepat sekali; method/path/status/permission/policy/OpenAPI dan request/response fixtures sesuai keputusan parity. |
| Auth/security | 15 menit access, rotasi refresh 30 hari, replay family revocation, user inactive, JWT misuse, public DTO, forbidden/unauthorized, login throttling; tidak ada token/hash di log/audit. |
| Database | Fresh migration, upgrade dengan fixture lama, rollback required audit, unique/FK/index, seed idempotent, migration gagal menghentikan startup Compose. |
| Redis | Memory satu instance; Redis limit bersama dua instance; Redis cache outage fallback; limiter Redis outage mengubah readiness dan auth sesuai policy. |
| Upload | Local + MinIO/S3 valid/invalid MIME, batas ukuran, traversal/symlink, DB failure compensation, orphan dry run/apply. |
| HTTP/ops | CORS allow/deny/no Origin, UTC/WIB/WITA/WIT/DST, `/live` vs `/ready`, Compose/manual startup, graceful shutdown, image non-root. |
| Template | Scaffold/initializer menghasilkan proyek yang dapat build/migrate/start; paket release hanya berisi allowlist file. |

CI Linux menjalankan semua gate relevan dengan PostgreSQL disposable, Redis dan MinIO profile; Windows menjalankan build/unit/scaffold serta smoke manual tanpa Docker bila memungkinkan. Pisahkan unit test dari integration test yang membutuhkan service; test yang ter-skip harus terlihat jelas. Kelulusan CI membuktikan konfigurasi runner, bukan otomatis kapasitas, backup restore, HA, atau kesiapan produksi di VPS pengguna. `verify:template` lokal tanpa service boleh menjalankan build/contract/static check, sedangkan integration gate berjalan di CI/Compose.

## 12. Pertanyaan wajib untuk agent implementasi

Agent harus mengajukan pertanyaan **saat tahap keputusan terkait tercapai**, menyebut pilihan dan konsekuensinya, lalu melanjutkan pekerjaan independen sambil menunggu jawaban. Jangan memilih diam-diam untuk keputusan yang mengubah data, lokasi, atau kontrak publik. Pertanyaan yang sudah terjawab dalam percakapan tidak perlu diulang.

1. **Lokasi kerja:** apakah prototipe `template-JS/nestjs` ingin direfaktor in-place, atau buat sibling baru (nama folder apa)? Prototipe belum tampak sebagai repo Git pada audit rencana. Jika repo/remote baru diminta, minta URL/nama yang tepat sebelum membuat atau push.
2. **Data lama:** apakah MySQL prototipe memuat data yang harus dimigrasikan? Default yang direkomendasikan ialah PostgreSQL baru milik NestJS dan migration awal baru. Jangan menghapus database/file MySQL tanpa jawaban eksplisit.
3. **Parity HTTP:** apakah NestJS wajib mempertahankan `/api/...` dan envelope/field saat ini, termasuk `GET /api/auth/me`, atau pengguna ingin versi/prefix baru? Tampilkan diff Express terkini vs Go terkini sebelum meminta keputusan atas konflik yang nyata.
4. **Auth response:** apakah nama field token final mengikuti `token` + `refreshToken` pada keluarga template, atau `accessToken` + `refreshToken`? Pilih satu untuk DTO, OpenAPI, contoh curl, dan fixture setelah dijawab.
5. **Distribusi:** apakah cukup repo template + generator fitur, atau juga paket initializer npm publik? Jika publik, minta nama paket/remote dan kebijakan lisensi sebelum publikasi.
6. **Tambahan modul:** prototipe memiliki SSE dan contoh SMTP. Apakah keduanya dipertahankan sebagai fitur opt-in yang terdokumentasi atau dikeluarkan dari template dasar? Jangan mengklaimnya setara dengan Express/Go bila belum diuji.

Jika pengguna meminta agent mengimplementasikan dokumen ini di chat baru, instruksi awal yang dapat disalin:

> Implementasikan `docs/NESTJS-PRODUCTION-TEMPLATE-PLAN.md` di folder NestJS yang saya tentukan. Baca `AGENTS.md`, README, source NestJS, registry/DTO/schema/migration Express dan Go terkini sebelum mengedit. Tanyakan keputusan pada §12 tepat saat diperlukan; berikan pilihan konkret dan tunggu jawaban untuk keputusan yang mengubah lokasi, data, atau kontrak publik. Kerjakan bagian independen sambil menunggu. Ikuti struktur dan lifecycle idiomatis NestJS, TypeScript strict, PostgreSQL terpisah, DTO publik, registry policy bertipe, dan bukti test/CI sesuai gate. Pertahankan pekerjaan lokal. Jangan commit, push, publish, atau deploy kecuali saya minta secara eksplisit.

## Referensi resmi untuk implementasi

- [NestJS modules dan providers](https://docs.nestjs.com/modules), [request lifecycle](https://docs.nestjs.com/faq/request-lifecycle), [testing](https://docs.nestjs.com/fundamentals/testing).
- [NestJS configuration](https://docs.nestjs.com/techniques/configuration), [validation](https://docs.nestjs.com/techniques/validation), [rate limiting](https://docs.nestjs.com/security/rate-limiting).
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [Swagger CLI plugin](https://docs.nestjs.com/openapi/cli-plugin), [file upload](https://docs.nestjs.com/techniques/file-upload).
- [Prisma dalam NestJS](https://docs.nestjs.com/recipes/prisma), [deploy Prisma migrations lewat CI/CD](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-migrations-from-a-local-environment).

Referensi ini menjelaskan mekanisme framework. Detail bisnis, field dan respons tetap harus diambil dari source template keluarga yang sedang berlaku dan disetujui pengguna.
