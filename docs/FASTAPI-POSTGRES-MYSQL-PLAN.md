# Rencana FastAPI dan PostgreSQL/MySQL untuk Lima Template

Tanggal: 1 Oktober 2026.
Status: implementasi source dan CLI tersedia; sepuluh kombinasi Compose dan consumer Windows lulus lokal. Lihat `FASTAPI-POSTGRES-MYSQL-IMPLEMENTATION-STATUS.md` untuk bukti, artifact dan gate rilis yang masih terbuka. Versi npm publik belum diperbarui.

## 1. Keputusan dan tujuan

- FastAPI menjadi framework kelima.
- PostgreSQL dan MySQL tersedia untuk seluruh lima framework melalui CLI npm; PostgreSQL tetap default.
- Repo FastAPI: https://github.com/RidhuanDEV/modular-fastapi.git.
- Folder: `D:/Ridhuan Ngoding Moment/React/template-JS/modular-fastapi`, sebagai repo saudara dan submodule induk saat integrasi.
- Arsitektur/library mengikuti framework masing-masing; fitur backend mengikuti kontrak source template existing.
- Engine dipilih saat generate proyek. Konfigurasi operasional dynamic tetap melalui env dan redeployment.
- Target adalah sepuluh kombinasi framework/database yang benar-benar diuji, dengan proyek hasil CLI mandiri.

Baseline root: `3d1b4f644df1bf4dfa137c98fe596fa872f8c45b`, CLI `create-ridhuan-backend@1.3.0`.

| Repository | Commit baseline |
| --- | --- |
| Express | `afff779f7ce45ee5fa8fb1e2f8c73a4d6e7abebb` |
| NestJS | `8bc3d09080ed631789dc5e26ae06536cd6b7ddc5` |
| Go | `f628ab3f00b577c526b4821dffb0e4df7d728ff2` |
| ASP.NET Core | `31b1d937905f5ea70f04140726e92a05181e5446` |

Pemeriksaan remote FastAPI berhasil tanpa mengembalikan branch. Cek ulang isi/branch sebelum clone/init; jangan menganggap repo masih kosong pada tahap implementasi.

## 2. Temuan source dan dampak refaktor

| Source | Kondisi sekarang | Perubahan |
| --- | --- | --- |
| CLI src/types.ts | Empat TemplateId; tidak ada DatabaseProvider/Python | Tambah fastapi, engine bertipe, Python/uv requirements dan metadata provider |
| CLI src/templates.ts | Descriptor/port PostgreSQL per framework | Registry framework + database + command + port/provider contract |
| CLI src/prompts/db-check.ts | pg.Client untuk autentikasi dan SELECT | Adapter MySQL dengan timeout, TLS, klasifikasi error dan cleanup |
| CLI scripts/prepare-templates.mjs | Snapshot empat repo dengan hash/commit | FastAPI, overlay database, supported-provider manifest |
| Prisma Express/Nest | PostgreSQL, Timestamptz; Nest memakai Uuid | Schema/client/migrasi dan adapter MySQL sesuai native types |
| Go sqlc | PostgreSQL, pgx/v5, RETURNING/ON CONFLICT/casts | Query/generated code/driver/migration MySQL terpisah |
| EF Core .NET | EF 10.0.12, Npgsql 10.0.3, jsonb/timestamp with time zone | Provider MySQL, UTC/UUID/JSON mapping, migration/model snapshots |
| CI/consumer | Empat template PostgreSQL | Sepuluh kombinasi dan Python toolchain/distribution |

Connection string saja tidak cukup. Migration PostgreSQL existing beserta checksum/ID dipertahankan. Kontrak dibaca dari registry, DTO/schema, mapper, service dan persistence; angka endpoint dalam dokumen lama tidak menjadi sumber tunggal.

## 3. Matrix library target

| Framework | PostgreSQL | MySQL | Struktur dipertahankan |
| --- | --- | --- | --- |
| Express | Prisma 7 + adapter-pg/pg | Prisma 7 + adapter-mariadb | Modul, Zod, controller/service/repository |
| NestJS | Prisma 7 + adapter-pg/pg | Prisma 7 + adapter-mariadb | Nest Module/Controller/Service/Provider, class DTO |
| Go | pgx/v5 + sqlc + Goose | database/sql + go-sql-driver/mysql + sqlc + Goose | cmd/internal, handler/service, ports/adapters |
| ASP.NET Core | EF Core + Npgsql | EF Core + MySql.EntityFrameworkCore (Oracle/MySQL) | Domain/Application/Infrastructure/Api |
| FastAPI | SQLAlchemy 2 + psycopg async | SQLAlchemy 2 + aiomysql | Modul fitur, APIRouter/Depends, service/repository, Pydantic |

Library akses DB existing tetap dipakai. Varian Sequelize/TypeORM/GORM mempunyai scope dan matrix QA terpisah dari pekerjaan ini.

NuGet MySql.EntityFrameworkCore 10.0.9 yang diperiksa mencantumkan dukungan EF Core 10. Ini kandidat spike .NET, bukan bukti runtime template lulus. Verifikasi restore, runtime, mapping, transaksi dan lisensi sebelum mengaktifkan .NET/MySQL di CLI. Pomelo 9 tidak dipasang pada EF Core 10 hanya berdasarkan kesamaan nama provider. Bila spike gagal, laporkan reproduksi dan keputusan library yang diperlukan; jangan menurunkan .NET/EF atau mengklaim dukungan semu.

Pin dependency/image stabil setelah verifikasi; catat publisher, lisensi, compatibility dan sumber di DEPENDENCIES.md. PostgreSQL mempertahankan major template sekarang; kandidat MySQL 8.4 LTS. Patch/digest dipilih melalui pull/build dan acceptance.

Referensi: [Prisma MySQL](https://docs.prisma.io/docs/orm/v6/overview/databases/mysql), [sqlc support](https://docs.sqlc.dev/en/latest/reference/language-support.html), [MySQL EF package](https://www.nuget.org/packages/MySql.EntityFrameworkCore), [SQLAlchemy MySQL](https://docs.sqlalchemy.org/en/20/dialects/mysql.html).

## 4. Arsitektur FastAPI

### 4.1 Prinsip

Modular monolith dengan modul per fitur. APIRouter mengelompokkan route, Depends menyusun dependency, lifespan mengelola engine/cache/shutdown, Pydantic menjadi kontrak transport, dan SQLAlchemy menangani persistence. Ini desain template yang dipilih; FastAPI tidak menetapkan satu struktur enterprise wajib.

- Router: request/dependencies/response model/status HTTP.
- Service: use case, batas transaksi, authorization bisnis.
- Repository: query SQLAlchemy sesuai concern modul; hindari generic repository serbaguna.
- Public DTO terpisah dari ORM entity; tidak mengembalikan model persistence langsung.
- Service tidak menerima FastAPI Request/Response. Composition root menyediakan dependency bertipe.
- AsyncSession dimiliki satu unit kerja; tidak dibagi ke task paralel. Background task memakai scope baru.
- Use case commit sebelum respons sukses. Dependency yield menutup resource, tanpa commit tersembunyi setelah respons.
- SSE tidak menahan session database sepanjang koneksi; gunakan scope query pendek per batch.
- Tidak menyalin controller TypeScript atau lapisan C# secara mekanis ke Python.

### 4.2 Struktur target

```text
modular-fastapi/
  .github/workflows/ci.yml
  .env.example
  .env.mysql.example
  .gitignore
  .gitattributes
  AGENTS.md
  README.md
  DEPENDENCIES.md
  LICENSE
  pyproject.toml
  uv.lock
  .python-version
  Dockerfile
  compose.yaml
  compose.mysql.yaml
  compose.override.yaml.example
  alembic.ini
  migrations/
    env.py
    script.py.mako
    postgresql/versions/
    mysql/versions/
  contracts/
    endpoints.json
    behavior-differences.md
  docs/
    ARCHITECTURE.md
    OPERATIONS.md
    EXTENDING-MODULES.md
  scripts/
    export-openapi.py
    verify-template.py
    generate-module.py
    init-bucket.sh
  src/app/
    __init__.py
    main.py
    lifespan.py
    api/             # router, registry, route metadata, envelopes, errors
    core/            # settings, logging, clock, security, explicit types
    database/        # base, engine, session, native type/error mapping
    platform/
      audit/
      cache/
      rate_limit/
      storage/
      mail/
    modules/
      auth/
      users/
      roles/
      permissions/
      uploads/
      notifications/
      probes/
    cli/             # migrate, seed, cleanup_uploads
  tests/
    unit/
    contract/
    integration/
    consumer/
```

Pola modul: router.py, schemas.py, models.py, repository.py, service.py, dependencies.py. Buat hanya file yang concern-nya ada; probes tidak memerlukan model/repository kosong. Package import `app` stabil; nama distribusi/proyek boleh berubah tanpa mengganti seluruh import. Src layout dipasang sebagai package sehingga startup/test tidak membutuhkan PYTHONPATH ad hoc.

### 4.3 Toolchain

| Kebutuhan | Library/pola |
| --- | --- |
| Runtime | Python stable dipin; kandidat 3.13, patch/wheel Windows/Linux diverifikasi |
| API | FastAPI, Starlette sesuai compatibility, Uvicorn |
| DTO/config | Pydantic v2 + pydantic-settings, tipe input/response eksplisit |
| Persistence | SQLAlchemy 2 typed declarative: Mapped/mapped_column/AsyncSession |
| Migration | Alembic, lokasi versi per provider |
| Auth | PyJWT, pwdlib + Argon2, secrets stdlib |
| Redis | redis-py asyncio, timeout/namespace dan lifecycle eksplisit |
| S3 | boto3; blocking I/O lewat threadpool bounded |
| Upload | UploadFile + python-multipart; content MIME validation dengan library terverifikasi |
| SMTP | aiosmtplib; STARTTLS/implicit TLS, certificate validation |
| SSE | Native EventSourceResponse/ServerSentEvent pada versi stable yang dipin |
| Logging | Python logging JSON dengan formatter terawat, redaksi secret/token |
| Tooling | uv.lock, Ruff, Pyright strict, pytest/HTTPX/AnyIO, pip-audit |

API SSE native harus tersedia pada versi pin; bila tidak, dokumentasikan adapter Starlette/sse-starlette beserta test. Jangan mengarang import berdasarkan docs versi lain. Tidak menerapkan strict DTO secara membabi-buta pada query string HTTP sehingga request normal ditolak.

Manual install: `uv sync --locked --extra postgresql` atau `--extra mysql`. Mode manual memeriksa Python/uv; Docker tidak mewajibkan Python host; no-install dapat generate tanpa interpreter. Tidak mengganti Python global/PATH pengguna. Interpreter/venv yang dipakai harus sama dengan preflight.

Semua parameter/return diberi tipe; jangan menyebarkan Any atau cast untuk menutupi kontrak. Boundary SDK/JSON yang tidak bertipe dipersempit dalam adapter. Lockfile terjaga sesudah project rename; resolver unrestricted tidak dipakai untuk menyembunyikan lock drift.

Referensi: [FastAPI struktur aplikasi](https://fastapi.tiangolo.com/tutorial/bigger-applications/), [dependencies yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/), [SQLAlchemy async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html), [FastAPI security](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/), [FastAPI SSE](https://fastapi.tiangolo.com/tutorial/server-sent-events/), [uv locked sync](https://docs.astral.sh/uv/concepts/projects/sync/).

## 5. Fitur dan kontrak FastAPI

FastAPI mengikuti kontrak Express terbaru yang ditemukan pada source, dengan perbedaan keamanan/framework ditulis eksplisit. Operation count dihitung dari manifest/registry aktual. Akun/hash/database tidak dibagikan lintas framework.

1. Auth: register/login/me, access token 15 menit, refresh opaque disimpan sebagai hash, rotation/reuse family revocation, logout sesuai registry Express. Refresh lifetime berasal dari reference actual. Soft-deleted user tidak dapat login/refresh/menggunakan token.
2. RBAC: users/roles/permissions/assign-permissions; grants dibaca live; anti-escalation; permission concern terpisah. Public response memakai DTO allowlist tanpa password/hash/internal state.
3. Registry: endpoint ID Enum, immutable typed policy, method/path/module/access/permission/audit/rate/cache/status/operationId. Startup memeriksa route-registry-OpenAPI; built-in docs route exceptions dicatat.
4. Dynamic env: required/optional/none audit; auth/public/internal limiter; cache read/off; override endpoint dari env. Unknown endpoint/field dan invalid combination fail startup. Perubahan melalui redeployment, tanpa admin UI runtime.
5. Audit: before/after redacted, actor, module, behavior, entity/request ID dan UTC. Required audit + mutation satu transaksi; optional failure semantics ditulis dan diuji.
6. Upload: `/api/upload` menurut reference, lokal default/S3 opsional, streamed limit, content MIME validation, safe keys, DB metadata/status/retention/cleanup. Tidak membaca file besar seluruhnya ke RAM.
7. Cache: Redis optional, endpoint contoh/TTL/namespace, bounded outage fallback; invalidation/version setelah commit menghindari data stale hidup kembali.
8. Limiter: semua endpoint tercatat, env quota/window, memory satu instance, Redis beberapa worker/replica. Multi-instance memory configuration ditolak. Required limiter Redis outage mempengaruhi readiness sesuai failure contract.
9. Notifications: DB persistence, list/get/mark-read sesuai reference, authenticated SSE. Manage/send memakai manage_notifications; recipient hanya membaca miliknya. Users/roles/uploads/mail memiliki concern permission masing-masing.
10. SSE: heartbeat, disconnect cleanup, bounded queue/batch, stable cursor/replay, recipient isolation. DB polling menyediakan lintas replica ketika Redis off; delivery/dedup berdasarkan ID didokumentasikan. Tidak mengirim token melalui URL; frontend example memakai fetch Authorization header. Streaming tidak menahan DB transaction.
11. SMTP: default off, TLS/STARTTLS, secret env; endpoint/module contoh mengikuti source registry. Kegagalan SMTP setelah commit tidak membatalkan transaksi yang sudah tersimpan; status/failure contract jelas.
12. Time: UTC di storage/response, backend authority, zoneinfo/IANA untuk WIB/WITA/WIT dan luar negeri/DST; tidak menambah angka offset server secara manual.
13. Probes: /live, /ready, /health alias ringan; readiness DB + required limiter Redis; cache-only Redis tidak wajib; liveness tanpa DB call.
14. Docs: Pydantic + route metadata untuk OpenAPI/docs/redoc. Validation/default 422 diselaraskan dengan error contract referensi melalui handler teruji; jangan menganggapnya otomatis sama dengan 400.
15. Operasi: env validation, CORS allowlist/production requirement, trusted proxy eksplisit, request ID/redacted logs, graceful shutdown, manual/Docker, migration release job one-shot, seed explicit/idempotent.

## 6. Kontrak persistence lintas engine

### 6.1 Pemilihan provider

- Canonical DatabaseProvider: postgresql | mysql; alias postgres/pg dinormalisasi.
- Generation menyimpan provider dalam metadata proyek. Driver/schema/migration/Compose harus sesuai pilihan ini.
- DB_PROVIDER env yang bertentangan dengan bundle hasil generation fail fast; tidak fallback ke database lain.
- Satu database per proyek dan satu migration owner sesuai framework.
- Perpindahan database berisi data merupakan proyek migrasi data terpisah; initializer tidak melakukan konversi existing DB.

### 6.2 Mapping yang diuji

| Concern | PostgreSQL | MySQL | Kontrak aplikasi |
| --- | --- | --- | --- |
| UUID | Native uuid bila dipakai model existing | CHAR(36) dengan mapping jelas | UUID string dan nullability DTO sama |
| Waktu | timestamptz/UTC | datetime fractional precision, session UTC | UTC aware, response ISO UTC |
| JSON | jsonb/JSON menurut model | JSON | Typed/redacted, null SQL dan JSON dibedakan |
| Unique/index | Semantik existing | Collation/length/index eksplisit | Normalisasi email; token hash/object key case-sensitive |
| Upsert | ON CONFLICT/native adapter | ON DUPLICATE KEY/native adapter | Seed idempotent, tanpa read-create race |
| Refresh | Lock/isolation/CAS sesuai provider | InnoDB lock/isolation/CAS | Satu refresh aktif, bounded retry, reuse revocation |
| Audit | Database transaction | InnoDB transaction | Audit required gagal => mutation rollback |
| Error | SQLSTATE PostgreSQL | Error codes MySQL | Domain 409/503 contract, tanpa SQL/secret bocor |
| Query | PostgreSQL syntax | MySQL syntax | Allowlist filter/sort/page/count dan deterministic order |

MySQL memakai InnoDB/utf8mb4. Set session timezone `+00:00` saat connection pool dibuka, tanpa bergantung pada timezone OS atau timezone tables server. Driver datetime tanpa tz hanya diperlakukan sebagai UTC di adapter yang sudah menjamin session UTC. Response precision sesuai kontrak framework; uji WIB/WITA/WIT dan DST. Provider-specific index/cast/default/schema tidak bocor ke DTO/use case.

### 6.3 Migration safety

- Jangan edit/delete PostgreSQL migration existing, checksum atau ID.
- Tambah history/snapshot MySQL dari model yang dipetakan; history setiap provider terpisah.
- EF: migration set/assembly/design-time context sesuai engine; model cache tidak memakai model PostgreSQL untuk MySQL.
- Prisma: schema/client/config/provider dipilih eksplisit; provider tidak dianggap berubah hanya dari URL.
- sqlc: query/config/output per provider, bukan replace regex PostgreSQL SQL menjadi MySQL.
- Alembic: version location per provider; candidate autogenerate direview sebelum digunakan.
- Fresh DB dan upgrade dengan data lama wajib lulus; schema/model drift menggagalkan CI. Downgrade hanya dijanjikan jika diuji.

Referensi: [EF multiple-provider migration](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/providers), [Alembic autogenerate](https://alembic.sqlalchemy.org/en/latest/autogenerate.html).

## 7. Perubahan empat framework existing

### Express / NestJS

1. Typed client factory/provider config untuk adapter-pg dan adapter-mariadb, termasuk TLS/pool/timeout/session UTC.
2. Spike strategi generated clients: output terpisah + persistence ports, atau satu provider saat generation. Tidak menyatukan client melalui unsafe cast.
3. Schema dan history per provider; seluruh PostgreSQL migration tetap upgrade-compatible.
4. Mapping native types, query, transaction/retry/error, JSON/UTC; controller DTO/auth envelope/registry tidak berubah karena engine.
5. Express tetap Zod; Nest tetap class-validator/class-transformer/Swagger/DI. Tidak mengganti ORM atau arsitektur tanpa scope baru.
6. CRUD/feature generator output provider terpilih dibangun dan diuji, bukan hanya source existing.

### Go

1. Service ports/cmd/internal tetap; PostgreSQL pgx, MySQL database/sql + go-sql-driver/mysql.
2. Folder queries/sqlc generated types/Goose migrations per provider; UUID/null/time mapping eksplisit.
3. RETURNING/casts/upsert menjadi query MySQL benar, dengan rows affected/read-after-mutation dalam transaksi.
4. Context cancellation, bounded timeouts/pools, DSN parseTime/charset/UTC sesuai driver.
5. Native initializer memperoleh provider/env/DSN/Compose/docs yang sama benar; GOWORK=off tetap untuk consumer tooling.
6. sqlc regenerate/diff, build/vet/race dan database integration kedua engine.

### ASP.NET Core

1. Spike Oracle MySQL EF10: locked restore, Release build, CRUD/migration, UTC DateTimeOffset, JSON/GUID, concurrency/retry.
2. Provider composition di Infrastructure; Domain/Application bebas driver/connection string.
3. Migration assemblies/model snapshots/design-time factories dan model cache sesuai provider; PostgreSQL IDs/history dipertahankan.
4. Converter UTC dan mapping GUID/JSON/index/collation; tidak menyalin schema public/jsonb/native PostgreSQL types ke MySQL.
5. Migrator/seed/cleanup/run.ps1/run.py/native initializer/NuGet template memahami engine. Force-evaluate seluruh affected lockfiles lalu kembali ke locked restore.
6. Preserve explicit HTTP DTO, accessToken naming, live grants dan documented differences; jangan menyeragamkan kontrak dengan tebakan.

## 8. CLI npm dan distribution

### 8.1 Target flags dan registry

- Tambah --template fastapi dan --database postgresql|mysql; default PostgreSQL mempertahankan command lama.
- Wizard: framework -> database -> mode -> ports/credentials -> Redis/storage. Password masked dan automated secret input lewat env.
- Typed descriptor menyatakan supported providers, runtime, commands, schema/migration/Compose selection. Unsupported pair ditolak sebelum file write.
- Runtime manifest diperbarui untuk Python/uv, termasuk whitelist parser. Manifest schemaVersion/compatibility diputuskan eksplisit, bukan mengubah JSON tanpa reader/test.
- MySQL diagnostics menggunakan driver Node terawat seperti mysql2, SELECT 1, timeout/TLS dan cleanup; credentials tidak dicetak.
- Snapshot clean source/hash/inventory/LF/gitignore-before-secret tetap dipertahankan; tambah FastAPI submodule dengan remote pengguna.
- Transform pyproject/uv.lock secara terstruktur; nama import app stabil; locked sync harus lulus setelah project rename.
- Install selected provider dependencies; output project mandiri, recovery/install errors tetap jelas.

### 8.2 Default ports

| Framework | HTTP manual/host | HTTP container | PostgreSQL manual/host | MySQL manual/host |
| --- | --- | --- | --- | --- |
| Express | 3000 | 3000 | 5432 | 3306 |
| NestJS | 3000 | 3000 | 5432 | 3306 |
| Go | 8080 | 8080 | 5432 | 3306 |
| ASP.NET Core | 5080 | 8080 | 55432 (existing CLI) | 3306 |
| FastAPI | 8000 | 8000 | 5432 | 3306 |

Internal DB ports 5432/3306; custom --port/--db-port dan Compose override konsisten pada env/launcher/probes/docs. .NET PostgreSQL default existing dipertahankan. CI memakai port bebas per job.

### 8.3 Command target setelah implementasi

```sh
npx create-ridhuan-backend@latest my-api --template fastapi --database postgresql
npx create-ridhuan-backend@latest my-api --template fastapi --database mysql
npm create ridhuan-backend@latest my-api -- --template nestjs --database mysql
```

Flag ini belum tersedia pada 1.3.0. GETTING-STARTED.md hasil generation memuat locked install, explicit migrate/seed, build/verify/start, env location, live/ready/docs, Docker/hybrid dan recovery sesuai engine.

## 9. Containerization dan operasi

- Generated Compose standar berisi satu engine terpilih. Source repo dapat mempunyai varian/overlay; instruksi tidak memulai kedua DB sekaligus.
- Migration one-shot menunggu DB healthy; API menunggu migration completed_successfully. Seed explicit/idempotent, bukan efek samping replica startup.
- Seed ulang tidak mengganti existing password. Credentials initializer/Compose/driver/migrate harus berasal dari konfigurasi yang sama.
- Runtime image non-root; satu Uvicorn process per container default. Lebih dari satu worker/replica membutuhkan shared limiter/feed yang sesuai.
- Redis/local/S3/bucket init/SMTP/readiness/fallback tetap optional sesuai contract. Upload dan metadata durable.
- Bind dependency development ke loopback; override ports/images/health/shutdown dites. Dev tooling berada di build/test stage.
- Dokumentasi manual/Compose/hybrid mencakup TLS/pooling, migration release job, backup/restore per engine dan batas memory limiter.

## 10. Acceptance dan CI

Required matrix: lima framework x dua engine = sepuluh pasangan. Windows/Linux menguji install/build/typecheck/contract/generator consumer dari artifact yang sama. Linux menguji fresh/upgrade/runtime dan Compose seluruh pasangan. macOS smoke CLI/install/preflight; native runtime diumumkan sesuai hasil yang benar-benar dijalankan. Batasi concurrency agar Go/MinIO build tidak menghabiskan RAM.

- [ ] Semua pasangan generate/install locked/build dari luar checkout induk.
- [ ] npx/npm create/installed binary lulus; default PostgreSQL backward compatible.
- [ ] Python src imports/pyproject/lock/launcher benar setelah custom project name.
- [ ] Route/registry/OpenAPI/status/permission contract sesuai source aktual.
- [ ] Credential escaping/Unicode, default/custom ports, TLS dan DB diagnostics diuji dua engine.
- [ ] Fresh/upgrade mempertahankan data, IDs, grants, notifications dan refresh state.
- [ ] Seed idempotent/parallel fixtures tidak unique race dan tidak reset password.
- [ ] Access token 15 menit, safe DTO, refresh concurrent rotation/reuse dan logout benar.
- [ ] Live grants/anti-escalation/soft delete/recipient isolation melalui HTTP asli.
- [ ] Required audit failure rollback mutation di kedua engine; JSON/null/redaction benar.
- [ ] UTC/WIB/WITA/WIT/DST benar saat timezone server/DB berbeda.
- [ ] Filter/sort/page/count, Unicode/case-sensitive uniqueness, FK/index/length semantics benar.
- [ ] Memory limiter satu instance, shared Redis dua replica, readiness/failure/startup guards benar.
- [ ] Cache optional outage/fallback/version invalidation tidak menghidupkan stale data.
- [ ] Local/S3 upload, MIME/size, bucket init, retention/cleanup lulus.
- [ ] Notifications/SSE replay/mark-read lintas dua replica, Redis off/on, bounded connection cleanup.
- [ ] SMTP off, STARTTLS/implicit TLS dengan fixture CA; production certificate validation tetap aktif.
- [ ] DB/required Redis outage mempengaruhi readiness; liveness tetap 200; cache-only tidak menjatuhkan readiness.
- [ ] Migration exit 23 menahan API Compose untuk kedua engine.
- [ ] Package bebas .env/.venv/cache/dependencies/uploads/local output/credentials.
- [ ] Clean recursive checkout menghasilkan artifact lengkap; required source/root workflows hijau.
- [ ] Sesudah publish, registry version/integrity dan fresh npx generation/build sepuluh pasangan lulus.

SQLite tidak menggantikan acceptance PostgreSQL/MySQL. Unit/contract fixtures berasal dari DTO/registry; migration/model drift dan generated feature compile menjadi gate. Build sukses tidak sama dengan load/production/deployment acceptance.

## 11. Fase implementasi

### A. Contract baseline dan provider spikes

Baca README/AGENTS/source setiap repo; preserve .env/dirty work. Capture endpoint/behavior manifest dan baseline gates. Spike .NET EF10/MySQL lebih dahulu, lalu Prisma7/MySQL, sqlc/MySQL dan SQLAlchemy dua engine. Definisikan tipe/time/JSON/collation/error/concurrency dan migration strategy dari hasil aktual. Catat library publisher/license/version. Blocker dilaporkan sebelum menjanjikan support CLI.

### B. FastAPI standalone

Siapkan repo sesuai remote setelah cek isi/branch. Buat src package/toolchain locks/strict checks/config/DB composition, lalu auth/RBAC/registry/audit/upload/cache/limiter/notifications/SSE/SMTP/probes/docs. Tambah migration/seed/cleanup/module generator, examples, Docker/Compose/README kedua engine. Jalankan native dan runtime acceptance.

### C. Empat template existing

Prisma schema/adapters/history/generator Express lalu Nest; Go MySQL adapter/query/sqlc/Goose/initializer; .NET provider composition/mapping/migrations/tools. Setiap repo harus lulus PostgreSQL regression dan MySQL acceptance sebelum snapshot dikemas.

### D. CLI dan packaging

Tambahkan FastAPI submodule/descriptor, engine enum/flags/wizard, diagnostics/preflight, Python tooling, provider file/dependency/Compose selection, locks/manifests/hashes/docs/recovery. Uji tarball/npx/npm create untuk sepuluh pasangan. Capability registry/README hanya menyatakan pasangan yang sudah lulus.

### E. Commit dan release

Required source/root matrix menguji artifact yang sama. Review diff/package/secret inventory dan migration compatibility. Jika commit/push pekerjaan ini diminta: commit source dahulu, verify remote main, baru update root pointers/snapshots dan commit root. Pilih versi dari compatibility CLI/manifest serta registry actual. Publish sesudah authorization rilis dan seluruh required CI hijau; smoke versi baru/latest.

Rencana tidak menerbitkan npm, deploy, mengkonversi DB pengguna, atau mengotorisasi push baru otomatis.

## 12. Pertanyaan hanya untuk blocker nyata

Framework, kedua engine, remote FastAPI dan pola arsitektur sudah ditentukan; jangan meminta konfirmasi ulang.

Agent bertanya jika remote/folder berisi pekerjaan pengguna yang bertentangan; stable provider tidak dapat memenuhi kontrak penting; perbedaan API/security tidak dapat diselesaikan dari source/keputusan sebelumnya; atau diperlukan migrasi data existing/perubahan public contract yang nyata. Sertakan reproduksi/opsi konkret dan lanjutkan pekerjaan independen sambil menunggu. Routine pin/module names/typed adapters/fixtures/safe defaults diselesaikan dari source dan hasil verifikasi.
