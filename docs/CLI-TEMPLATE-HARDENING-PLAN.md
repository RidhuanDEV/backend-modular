# Audit dan Rencana Hardening CLI Empat Template Backend

Tanggal audit: **30 September 2026**
Status: **perbaikan source diimplementasikan; hasil verifikasi dan gate rilis ada di [laporan implementasi](CLI-TEMPLATE-HARDENING-IMPLEMENTATION.md)**
Paket publik yang diuji: **`create-ridhuan-backend@1.1.1`**
Repository induk: **`https://github.com/RidhuanDEV/backend-modular.git`**
Lokasi repository: `D:\Ridhuan Ngoding Moment\React\template-JS`

## 1. Tujuan dan batas penerimaan

Pengguna publik dapat menjalankan CLI lewat `npx`, `npm create`, atau instalasi paket, memilih Express TypeScript, NestJS, Go, atau ASP.NET Core, lalu mengikuti instruksi yang dihasilkan untuk memasang dependency, membangun, memigrasikan, seed, dan menjalankan API. Proyek hasil CLI harus berdiri sendiri tanpa checkout induk, sibling repository, file lokal pengembang, atau import ke proyek asal.

"Langsung dapat dipakai" berarti jalur setup yang didokumentasikan berhasil pada versi runtime yang didukung dengan PostgreSQL tersedia. Jalur Docker menyediakan service lokal; jalur manual memerlukan database dan layanan opsional yang telah disiapkan. CLI harus menjelaskan prasyarat dan kesalahan secara tepat. Hasil build atau health check sendiri tidak membuktikan kapasitas production, backup/restore, atau ketahanan VPS.

Lingkup ini memperbaiki distribusi dan pengalaman setup. Kontrak HTTP, arsitektur setiap framework, permission sesuai concern, access token 15 menit, refresh token, audit transaksi, Notifications PostgreSQL/SSE, SMTP opsional, upload, caching, serta registry endpoint tetap menjadi kontrak yang harus lolos regresi. Konfigurasi dynamic tetap melalui env dan redeployment.

## 2. Baseline dan metode audit

| Komponen | Commit saat audit |
| --- | --- |
| Repository induk dan CLI | `0add3c1eee1c116341bd60bb7cb6dcbf81e7aa39` |
| Express | `190dd47c11ec7138f99ff8a9baca24eb493d39e8` |
| NestJS | `a0d3cab4295fb334d7b6fbca36062046ef789dc3` |
| Go | `8f7a4c18fe0091a29a07b7e750581ba6effeb457` |
| .NET | `f97a1b5bf8eef5c5cf7b3b95345399d446b5719f` |

Paket `1.1.1` diambil dari registry npm, diekstrak, dan dipasang ke direktori sementara. Empat proyek dibuat dari paket terpasang dengan `--yes --no-install`. Selain invocation executable paket, audit menjalankan `npx create-ridhuan-backend@1.1.1 ...` dan `npm create ... -- ...` dari luar repository. Keduanya dapat membuat scaffold; ini belum menguji seluruh flow aplikasi.

Audit juga menjalankan install/build/verification pada proyek hasil paket, membandingkan file dengan daftar distribusi, menguji rename .NET, memeriksa hasil Compose untuk pilihan Redis/S3, menguji parsing password sintetis, dan membangun CLI dari file yang benar-benar tercatat di Git. Tidak ada kredensial pribadi digunakan dalam fixture atau dokumen ini.

Lingkungan: Windows/PowerShell, npm `11.16.0`, Go `1.27.1`, .NET SDK `10.0.401`, Docker `28.5.1`. Node host `24.9.0` menghasilkan peringatan engine NestJS; verification Express/NestJS dilanjutkan dengan Node `24.15.0` melalui runtime sementara tanpa mengganti instalasi Node pengguna. Go memerlukan `GOWORK=off` karena host memiliki workspace Go di direktori pengguna.

### Hasil yang benar-benar dijalankan

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` CLI saat ini | Lulus empat scaffold dan proteksi overwrite; hanya memeriksa beberapa file/string |
| Scaffold dari paket publik | Empat framework berhasil dibuat; seluruhnya kehilangan `.gitignore` |
| Entrypoint CLI dari file Git + kompilasi TypeScript | `dist/bin/index.js` tidak terbentuk karena source entrypoint tidak tercatat di Git |
| Express `npm ci` | Lulus |
| Express `npm run build` setelah install, sebelum generate | Gagal dengan missing Prisma exports, termasuk `User`/`Prisma`, dan error tipe turunan |
| Express generate Prisma lalu build | Lulus |
| Express `verify:template` dengan Node 24.15.0 | 14 tes lulus, kemudian gagal `MODULE_NOT_FOUND` pada `scripts/verify-package.mjs` |
| NestJS `npm ci` | Lulus; engine warning pada Node host yang terlalu lama |
| NestJS `verify:template` dengan Node 24.15.0 | Build, typecheck, validasi Prisma, kontrak, dan 9 tes lulus |
| Go `go build -p 1 ./...` dengan `GOWORK=off` | Lulus; import module hasil rename terkompilasi |
| .NET `dotnet restore --locked-mode` | Gagal `MSB3202`: empat project `tools` tidak ditemukan |
| Git pada hasil scaffold | `.env` tampil sebagai untracked, dan tidak di-ignore |
| Compose config dengan Redis/S3 dipilih | Express/Go tidak mengaktifkan service opsional; NestJS memerlukan flags profile yang dicetak CLI; .NET mengaktifkan profile lewat env |
| Password sintetis dengan `#` | Berubah saat dibaca dotenv Express/NestJS; godotenv Go mempertahankannya pada fixture ini |
| `--template invalid` | Exit 0 dan membuat Express melalui fallback pada invocation noninteraktif |

Belum dijalankan pada audit ini: migrasi database baru/upgrade, flow HTTP lengkap, SMTP server, upload ke object store nyata, dan build/startup Compose untuk keempat proyek hasil paket. Pemeriksaan Compose di atas adalah pemeriksaan konfigurasi, bukan bukti runtime service opsional. Kebutuhan tersebut menjadi gate implementasi dan rilis di bagian 7.

## 3. Temuan audit

P0 = risiko keamanan distribusi atau paket tidak dapat direproduksi dari checkout bersih. P1 = setup/build/konfigurasi pilihan pengguna dapat gagal. P2 = konsistensi, dokumentasi, atau coverage yang perlu diperbaiki sebelum rilis hardening.

| ID | Prioritas | Bukti dan dampak | Sumber utama |
| --- | --- | --- | --- |
| CLI-01 | P0 | Source `src/bin/index.ts` ada lokal tetapi di-ignore dan tidak tercatat di Git. Build file Git tidak menghasilkan executable yang dinyatakan `package.json`; rilis dapat bergantung pada `dist` lama. | `.gitignore:19`, `create-ridhuan-backend/package.json:7` |
| CLI-02 | P0 | Tarball publik tidak memuat `.gitignore` keempat template. CLI membuat `.env` dan melakukan Git init; secret dapat ikut commit ketika pengguna melakukan `git add .`. | Isi tarball `1.1.1`, `src/cli.ts:341`, daftar template pada `scripts/prepare-templates.mjs` |
| NET-01 | P1 | Daftar distribusi .NET tidak memuat `tools`, sedangkan solution dan Dockerfile membutuhkan Initializer, Migrator, Seeder, UploadCleanup. Restore gagal `MSB3202`; Dockerfile juga merujuk project yang tidak ada. | `scripts/prepare-templates.mjs:102`, `modular-NET/ModularBackend.slnx`, `modular-NET/Dockerfile` |
| EXP-01 | P1 | Express build tidak memastikan Prisma Client telah digenerate. Fresh install diikuti build gagal dengan missing exports; generate eksplisit memperbaikinya. Ini kegagalan lifecycle setup, bukan alasan melonggarkan tipe. | `modular-express-typescript-starter-postgre/package.json:9`, `src/scaffold/express.ts:81` |
| EXP-02 | P1 | Script `verify:template` hasil Express memanggil `scripts/verify-package.mjs`, tetapi folder itu tidak dikemas. Verifier asal juga bergantung pada initializer Express lama yang tidak dikemas. | `modular-express-typescript-starter-postgre/package.json:23`, `scripts/verify-package.mjs`, `scripts/prepare-templates.mjs:34` |
| NET-02 | P1 | Rename .NET tidak mencakup `.py`. Proyek `AuditNet` memiliki `scripts/run.py` yang masih menunjuk `src/ModularBackend.Api`. | `src/scaffold/dotnet.ts:53`, hasil `AuditNet/scripts/run.py:23` |
| NET-03 | P1 | Instruksi manual CLI memakai bare `dotnet run`, padahal .NET tidak membaca `.env`. `launchSettings.json` tetap memakai `5042` sementara env/Compose memilih `5080`; pilihan port tidak menjadi kebenaran tunggal. | `src/scaffold/dotnet.ts:143`, `modular-NET/scripts/run.ps1`, `src/ModularBackend.Api/Properties/launchSettings.json:8` |
| ENV-01 | P1 | Env ditulis sebagai `KEY=value` tanpa serializer. Password `#` tidak round-trip pada dotenv Express/NestJS. Risiko tambahan `$`, quote, backslash, dan delimiter connection string .NET harus diuji pada parser masing-masing. | `src/scaffold/express.ts`, `nestjs.ts`, `golang.ts`, `dotnet.ts` |
| CFG-01 | P1 | Wizard mengaktifkan Redis/S3 di aplikasi Express/Go tetapi tidak mengaktifkan profile Compose pada instruksi `up` biasa. NestJS mencetak flags khusus; perilaku antar template belum konsisten. | `src/scaffold/express.ts:81`, `golang.ts:104`, `nestjs.ts`, `dotnet.ts:120` |
| CFG-02 | P1 | Compose NestJS memiliki MinIO tanpa langkah pembuatan bucket; StorageService hanya memakai PutObject. Jalur Compose S3 belum menyediakan prerequisite upload secara lengkap. Runtime error upload belum direproduksi pada audit ini. | `nestjs/compose.yaml`, `nestjs/src/platform/storage/storage.service.ts` |
| CFG-03 | P1 | Scaffold .NET memakai endpoint S3 host `localhost:9000`, tetapi service S3Mock Compose dipublikasikan ke `19000`. Nilai S3 access key/region yang diterima adapter juga belum dipakai secara konsisten. | `src/cli.ts:314`, `src/scaffold/dotnet.ts:104`, `modular-NET/compose.yaml` |
| CLI-03 | P1 | Pemeriksaan PostgreSQL memakai socket/protokol buatan sendiri, tidak menerima password, dan menandai AuthenticationRequest sebagai authenticated. Wizard dapat menyatakan user valid sebelum autentikasi benar terjadi. Host/port selalu `localhost:5432`, termasuk .NET yang env-nya memakai `55432`. | `src/prompts/db-check.ts:86`, `src/cli.ts:209` |
| CLI-04 | P1 | Prasyarat selected template tidak diperiksa sebelum copy/install. CLI mengizinkan Node >=20 sementara NestJS memerlukan >=24.15; Docker user juga selalu diminta tool host bila tidak memakai `--no-install`. | `package.json:15`, `src/cli.ts:147`, `nestjs/package.json` |
| CLI-05 | P1 | Perintah Go dari CLI mewarisi `go.work` host. Build audit awal gagal karena proyek tidak berada dalam workspace tersebut; initializer Go asal sudah memiliki perlakuan `GOWORK=off`. | `src/cli.ts:147`, `modular-golang/cmd/initproject/main.go:149` |
| CLI-06 | P1 | Unknown template/flags diabaikan dan `--yes` tidak melewati pemilihan template pada TTY. Port memakai `parseInt(...) || default`, sehingga input parsial/tidak valid dapat diterima atau diganti diam-diam. | `src/cli.ts:51`, `:172`, `:192` |
| CFG-04 | P1 | Express hanya mengubah `APP_PORT`, bukan `PORT`. Custom port berlaku pada host Compose tetapi manual server tetap port lama. Lockfile Express tetap bernama `backend`. | `src/scaffold/express.ts:55`, `modular-express-typescript-starter-postgre/src/server.ts:23` |
| DOC-01 | P1 | Instruksi manual Go/.NET melewatkan migrasi/seed; .NET juga melewatkan env loader. Beberapa README mengarahkan ke initializer/packaging tool yang tidak disertakan. | `src/scaffold/golang.ts:104`, `dotnet.ts:135`, README template |
| QA-01 | P1 | Verifier CLI hanya menggunakan snapshot lokal dan `--no-install`; tidak menguji tarball, dependency install, build, service, atau clean checkout. Root repo belum memiliki workflow CLI. | `scripts/verify-cli.mjs`, tidak ada `.github/workflows` di root |
| PKG-01 | P2 | Pemilihan source memakai tracked + untracked files. Release belum memiliki manifest versi/hash untuk membuktikan snapshot berasal dari commit tertentu. License Express/Go dan beberapa file dokumentasi/tool yang dirujuk tidak masuk daftar distribusi. | `scripts/prepare-templates.mjs:13` |
| DOC-02 | P2 | Contoh `npm create ... --template ...` tidak memakai separator `--` untuk opsi initializer. Metadata repository npm menunjuk `create-ridhuan-backend.git`, sedangkan remote repo aktual `backend-modular.git`; banner versi hardcoded. | `create-ridhuan-backend/README.md`, `package.json`, `src/cli.ts` |
| CFG-05 | P2 | Framework default tersebar dalam wizard, env, runtime, Dockerfile, Compose, launcher, dan README. Go selalu mendapat default Node-style `3000`; .NET launcher berbeda dari env. | `src/cli.ts:186`, config/env/Dockerfile masing-masing template |

Tidak ditemukan import module Go yang gagal setelah rename pada build terisolasi. Verification NestJS lulus pada runtime yang didukung. Kedua hasil ini tidak meniadakan masalah distribusi dan konfigurasi pilihan opsional.

## 4. Kontrak setup dan default yang dituju

### 4.1 Default per framework

| Pengaturan | Express TypeScript | NestJS | Go | ASP.NET Core |
| --- | --- | --- | --- | --- |
| HTTP manual dan host Compose | `3000` | `3000` | `8080` | `5080` |
| HTTP container | `3000` | `3000` | `8080` | `8080` |
| Host PostgreSQL development | `127.0.0.1:5432` | `127.0.0.1:5432` | `127.0.0.1:5432` | `127.0.0.1:55432` |
| PostgreSQL di network Compose | `postgres:5432` | `postgres:5432` | `postgres:5432` | `postgres:5432` |
| Host Redis development | `127.0.0.1:6379` | `127.0.0.1:6379` | `127.0.0.1:6379` | `127.0.0.1:56379` |
| Object store development | MinIO `9000`; console `9001` | MinIO `9000`; console `9001` | MinIO `9000`; console `9001` | S3Mock `19000` |
| Local object store internal | `minio:9000` | `minio:9000` | `minio:9000` | `s3mock:9090` |
| Default fitur | Local upload; Redis/cache mati; limiter memory untuk satu instance; SMTP mati | Sama | Sama | Sama |

Go `8080` adalah pilihan konvensi template ini; Go/Chi tidak mewajibkan satu port default. .NET host `5080` mengikuti default env template saat ini, lalu seluruh launcher diselaraskan. ASP.NET container mempertahankan `8080` sesuai image Microsoft. Port database/Redis .NET yang sudah terpisah dipertahankan dan ditulis jelas; port tersebut merupakan pilihan template, bukan kewajiban framework.

Node template memakai baseline yang diuji `24.15.0`; daftar versi Node lain yang didukung harus berasal dari intersection engine dependency dan CI. Go mengikuti `go.mod` (`1.27.1` saat audit). .NET mengikuti `global.json` (`10.0.401` saat audit). Versi tersebut tidak digandakan sebagai nilai lepas di wizard.

`--port` mengatur HTTP manual dan host Compose. Container menggunakan port internal tetap yang dinyatakan descriptor. `APP_PORT` adalah host port Compose; runtime menggunakan `PORT` atau `ASPNETCORE_URLS`. Health probe mengarah ke port internal. README hasil generation mencetak URL yang benar. Menjalankan Express dan NestJS bersamaan memerlukan override port salah satunya.

### 4.2 CLI dan opsi

Tambahkan kontrak argumen bertipe untuk `--port`, `--mode manual|docker`, `--db-host`, `--db-port`, `--db-name`, `--db-user`, `--redis`, `--storage local|s3`, dan `--go-module`, selain opsi yang sudah ada. Sediakan `--help` dan `--version`. Jangan mengirim secret melalui argumen yang mudah tersimpan dalam shell history; password memakai prompt tersamarkan atau input env eksplisit.

`--yes` memilih default framework Express jika `--template` tidak diberikan dan tidak menunggu input. Unknown flag/template, argumen hilang, port di luar `1..65535`, nama/project path tidak valid, dan module path tidak valid harus gagal sebelum write. Path tujuan harus tetap berada dalam lokasi yang diizinkan CLI; folder nonkosong ditolak. Pisahkan nama folder, package npm, namespace C#, Go module, dan Compose project name agar normalisasi tidak mengubah kontrak lain diam-diam.

Mode manual memasang dependency tool host yang sesuai; mode Docker memeriksa Docker/Compose dan tidak memerlukan Go/.NET SDK host. `--no-install` melewati instalasi dependency dengan next steps lengkap. Default mode tetap manual agar perilaku existing invocation jelas; wizard dapat memilih Docker. Git optional dan tidak menghalangi scaffolding jika tidak tersedia.

## 5. Rencana implementasi

### Fase A — paket yang lengkap dan dapat dibangun dari Git bersih

1. Perbaiki root ignore untuk mengecualikan source entrypoint CLI dari aturan build `bin/`. Catat source tersebut di Git. Clean build membersihkan output CLI lama di folder yang telah diverifikasi lalu menghasilkan executable dengan shebang yang benar.
2. Kemas `.gitignore` sebagai aset bernama aman, misalnya `gitignore.template`, lalu materialisasikan `.gitignore` saat scaffold. Jangan mengandalkan npm mempertahankan dotfile tersebut. Materialisasi dilakukan sebelum `.env` dan Git init.
3. Buat manifest eksplisit setiap framework untuk semua file runtime, migration, seed, cleanup, generator, test, Docker, dan docs yang dijanjikan. Sertakan `tools` .NET, lockfile dependency, license, serta file yang dirujuk script. Build/release memakai source commit tercatat; untracked draft dan artefak lokal tidak menjadi input rilis.
4. Validasi graph file: setiap project dalam `.slnx` dan setiap path script/Dockerfile yang dideklarasikan harus ada di snapshot. Bedakan tool pemeliharaan repository dari tool aplikasi turunan.
5. Tambahkan manifest snapshot berisi schema version, template ID, source repository/commit, runtime requirement, dan hash file. Manifest dicatat bersama snapshot dan diuji terhadap sumber saat release.
6. Tambahkan pemeriksaan isi `.tgz` aktual: executable ada; asset ignore ada; `.env`, data upload, `.git`, `node_modules`, `bin/obj` hasil build, log, draft, dan credential pribadi tidak ada. Prisma generated client tidak dikemas; Go sqlc generated code yang merupakan source runtime tetap dikemas.

Selesai ketika install paket hasil clean checkout dan scaffold empat framework tidak membutuhkan file lokal pengembang, serta `git check-ignore .env` sukses di seluruh proyek.

### Fase B — kontrak konfigurasi CLI

1. Buat `TemplateDescriptor`/registry terpusat bertipe untuk port, versi tool, source module/prefix, nama profile, endpoint health/docs, command install/build/migrate/seed/start, dan env schema. Framework adapter menangani perbedaan format; tidak memaksakan struktur folder atau DTO lintas bahasa.
2. Aktifkan pemeriksaan TypeScript CLI yang ketat, termasuk indexed access dan optional property. Boundary JSON menggunakan `unknown` dengan validasi struktur. Tidak menutupi kegagalan generate/import dengan `any`, cast paksa, atau menurunkan strictness.
3. Parse dan validasi argumen sebelum menyentuh target. Sediakan error yang menyebut input/key bermasalah tanpa menampilkan secret. Pastikan cancellation memulihkan terminal dan memberikan exit code tepat.
4. Preflight tool/runtime berdasarkan selected template dan mode. Gunakan versi aktual manifest/engine/global.json; tampilkan instruksi pemasangan bila tool hilang. Jangan menjadikan engine warning npm sebagai validasi runtime yang memadai.
5. Ganti probe PostgreSQL buatan sendiri dengan driver PostgreSQL resmi yang menguji koneksi dan query sederhana menggunakan host, port, username, password, dan database sebenarnya. Bedakan unreachable, auth gagal, dan database belum dibuat. Mode Docker tidak meminta DB sudah aktif sebelum service dibuat.
6. Bangun serializer env yang diuji melalui parser aktual setiap framework dan Compose. Support `#`, `$`, quote, whitespace, backslash, dan Unicode; tolak newline/NUL. Bentuk URI PostgreSQL dengan encoding komponen. Bentuk connection string Npgsql menggunakan aturan escaping yang benar; pertimbangkan field env terpisah dan `NpgsqlConnectionStringBuilder` di tool .NET jika diperlukan.
7. Sediakan nama namespace Redis/Compose unik per proyek, secret JWT/bootstrap/S3 development acak, serta password prompt tersamarkan. Recovery install gagal menyatakan file sudah dibuat dan command untuk melanjutkan; tidak menimpa `.env` atau secret saat retry.
8. Process execution Windows harus menjaga quoting/path dengan spasi dan menangani `.cmd` secara eksplisit. Argumen user tidak dirangkai menjadi shell code. Set `GOWORK=off` hanya pada child process Go; jangan mengubah workspace/global environment pengguna.

### Fase C — perbaikan adapter tiap framework

**Express TypeScript**

- Set `PORT` dan `APP_PORT` sesuai model port. Sinkronkan nama root `package.json` dan lockfile lewat parser JSON.
- Jadikan generate Prisma bagian lifecycle build dan dev agar fresh install tidak menghasilkan missing exports. Sequence validate/generate/build tidak memerlukan koneksi DB hidup; migration tetap eksplisit.
- Pisahkan `verify:template` aplikasi dari verifikasi paket initializer repository lama. Proyek hasil CLI hanya menjalankan script yang dikemas dan tidak memerlukan `create-ridhuanbackendtemplate` sibling.
- Pastikan ESM import `.js`, alias hasil compile, Prisma adapter, dan generated CRUD terkompilasi pada hasil npm. Tambahkan regression generator dengan model/permission/registry yang berasal dari schema aktual.
- Instruksi manual memakai install yang deterministik, migrate deploy untuk schema bawaan, seed eksplisit, build/start atau dev. Docker command sesuai profile pilihan.

**NestJS**

- Pertahankan class DTO, `class-validator`, `class-transformer`, `ValidationPipe`, dan Swagger; tidak menambah Zod.
- Pertahankan generate Prisma sebelum build dan cek generated client CJS/output/import terhadap hasil distribusi. Uji `start:dev` fresh serta executable runtime/seed/docs setelah build.
- Lengkapi profile S3 dengan bucket provisioning terpisah yang idempotent, bounded retry, dan kredensial dari env. API baru menulis setelah bucket development tersedia; jangan membuat bucket production otomatis pada startup API.
- Selaraskan optional SMTP settings dengan library dan dokumentasi yang benar; test parameter yang diiklankan, termasuk pilihan TLS bila disediakan. Sinkronkan Compose forwarding dengan env schema.
- Verifikasi generator feature tidak membuat import yang salah dan tidak mengaktifkan endpoint tanpa registry/permission yang didefinisikan.

**Go**

- Terapkan port default `8080` konsisten pada config fallback, env, initializer Go, Dockerfile, Compose, test, dan docs. Project hasil CLI tidak menyisakan import module asal.
- Module path awal dibaca dari manifest/go.mod, lalu replacement dilakukan pada file sumber yang relevan, termasuk sqlc/generator config dan test. Jangan mengubah dependency path pihak ketiga atau metadata checksum secara sembarang.
- Jalankan dependency download/build dalam mode module terisolasi. Jangan memakai `go mod tidy` sebagai langkah wajib hanya untuk menyembunyikan dependency graph yang belum lengkap.
- Next steps manual mencakup `go run ./cmd/migrate`, seed terpisah, lalu API. Uji command api/migrate/seed/cleanup/initproject dan regenerate sqlc bila dijanjikan README.

**ASP.NET Core**

- Sertakan empat tool project dan semua dependency/lockfile yang dirujuk solution/Dockerfile. Restore locked mode dan Release build wajib lulus setelah rename.
- Gunakan transform nama yang mencakup `.py`, `.ps1`, project references, solution, namespace, assembly paths, tooling, Docker entrypoint, dan config. Semua script launcher harus menunjuk proyek hasil rename.
- Selaraskan `launchSettings.json`, env loader, host port, dan URL output; command run yang dicetak memakai env loader serta `--no-launch-profile` sesuai pilihan setup.
- Bangun env .NET berdasarkan key/schema terstruktur, bukan `replaceAll` placeholder yang dapat diam-diam gagal ketika template berubah. Semua expected key wajib ada.
- Descriptor .NET memakai host S3Mock `19000` dan internal `9090`; custom endpoint/region/key/bucket harus dihormati. S3Mock tetap fixture development; production menerima provider S3 sebenarnya.
- Pisahkan tool distribusi/template NuGet yang benar-benar dikemas dari instruksi generated project. Proyek turunan tidak mempunyai command README yang membutuhkan folder `templates` yang hilang.

### Fase D — setup manual, Compose, dan docs

1. Pilihan Redis/S3 menghasilkan profile aktif atau command yang konsisten pada keempat template. `docker compose up --build -d` yang didokumentasikan harus membawa service yang dipilih wizard.
2. Sediakan jalur hybrid manual API + Compose dependency. Publikasi port database/Redis untuk development eksplisit dan terikat loopback; environment host dan container memiliki URL terpisah yang berasal dari satu credential contract.
3. Migration tetap one-shot job sebelum replica API; seed adalah command eksplisit. Migrasi gagal menghentikan startup API. Profile Redis rate limiting harus siap sebelum acceptance readiness/auth; cache-only Redis tidak menjadi dependency readiness wajib.
4. Provisioning bucket development selesai sebelum acceptance upload. Uji semua image/tag yang dikemas dari build bersih; hindari tag `latest` yang tidak dapat direproduksi pada service opsional.
5. Cetak next steps sesuai mode dan status instalasi. Sertakan migrate, seed, health/docs URL, lokasi env, serta cara melanjutkan bila install gagal. Jangan mencetak nilai secret bootstrap; arahkan pengguna ke env lokalnya.
6. README hasil generation memakai nama/port/framework pengguna dan command shell yang benar, termasuk path ber-spasi pada Windows. Bagian public CLI memakai contoh berikut:

   ```sh
   npx create-ridhuan-backend@latest my-api --template nestjs --yes
   npm create ridhuan-backend@latest my-api -- --template nestjs --yes
   npm install -g create-ridhuan-backend@latest
   create-ridhuan-backend my-api --template nestjs --yes
   ```

7. Update repository/bugs/homepage npm berdasarkan remote aktual. Versi banner dibaca dari package metadata. Tidak ada bump/release otomatis sebelum semua gate lulus.

## 6. Pembagian perubahan repository

| Lokasi | Tanggung jawab |
| --- | --- |
| Root `template-JS/.gitignore` | Proteksi file lokal sambil mempertahankan source entrypoint CLI |
| `create-ridhuan-backend/src` | Parser, descriptor bertipe, prompt, env serializer, preflight, framework adapters, executable |
| `create-ridhuan-backend/scripts` | Paket snapshot, graph validation, tarball audit, smoke/release verification |
| `create-ridhuan-backend/templates` | Snapshot empat submodule yang telah diuji; diperbarui setelah source diperbaiki |
| Root `.github/workflows` | Clean checkout dengan recursive submodules, package artifact, matrix consumer, rilis npm terjaga |
| Express submodule | Lifecycle Prisma, script aplikasi, generator/import, env/Compose/docs |
| NestJS submodule | Prasyarat S3, env/Compose/docs, generator dan test kontrak |
| Go submodule | Port default, tooling/initializer, config/Compose/docs |
| .NET submodule | Launchers/config/ports, graph tools/solution, tooling/template docs |

Implementasi membaca aturan masing-masing repository dan mempertahankan perubahan pengguna. Commit submodule dibuat terlebih dahulu bila commit diminta; root memperbarui pointer/snapshot sesudahnya. Dokumen ini tidak mengotorisasi publish npm, deployment, atau perubahan global tool pengguna.

## 7. Strategi verifikasi dan release gate

### 7.1 Pemeriksaan cepat tanpa service eksternal

Checklist di bawah mencatat hasil lokal pada Windows dari tarball development. Clean checkout final dan matrix OS remote tetap belum dijalankan. Custom project names/namespace/module dan path ber-spasi telah lulus lokal; checkbox lintas OS menunggu CI.

- [ ] Checkout bersih dan recursive submodules menyediakan seluruh source untuk clean build CLI.
- [x] `npm pack` menghasilkan `.tgz` aktual dengan inventory aman dan lengkap; install/scaffold dilakukan dari `.tgz`, bukan import source repository.
- [x] Empat framework lolos invocation via installed binary, `npx`, dan `npm create` dengan separator opsi yang benar.
- [x] `--yes`, `--no-install`, help/version, unknown flags, alias template, invalid port/module/path, target nonkosong, cancellation, tool hilang, dan install gagal memiliki perilaku/exit code tepat.
- [ ] Custom project names, C# namespace, Go module, serta workspace path ber-spasi bekerja pada Windows dan Linux; macOS memperoleh smoke CLI/install pada runner tersendiri sebelum dinyatakan didukung.
- [x] Tidak ada source import/project reference ke template asal setelah rename; seluruh declared scripts dan solution paths ada.
- [x] `.gitignore` dipulihkan, `git check-ignore .env` sukses, dan `git add --dry-run .` tidak mencantumkan credential/dependency/upload runtime.
- [x] Nilai env dan credentials fixture round-trip pada dotenv, godotenv, loader .NET, Npgsql, dan Compose; output tes hanya nama key/status, tanpa secret.
- [x] Port default/custom cocok pada env, manual launcher, Compose config, probes, dan README. CI memakai port bebas per job agar tidak menganggap port sedang terpakai sebagai bug template.
- [x] Express/NestJS fresh install → build/typecheck/tests/docs berhasil tanpa langkah generate tersembunyi.
- [x] Go download/build/vet/tests berhasil dengan Go workspace host yang sengaja berbeda.
- [x] .NET locked restore → Release build → unit/contract tests berhasil setelah rename; tidak ada `MSB3202`/lockfile drift yang diabaikan.

### 7.2 Integration pada proyek hasil paket

Gunakan database PostgreSQL terpisah per framework/job, secret sintetis, dan service CI yang dapat dibersihkan. Jalankan pada hasil scaffold dari artifact yang sama dengan calon release.

- [x] Database kosong dapat dimigrasikan; seed idempotent; fixture upgrade dari migration awal mempertahankan data.
- [x] API start pada port pilihan; `/live`, `/ready`, dan OpenAPI dapat diakses. `/ready` gagal saat DB tidak tersedia menurut kontrak framework; outage cache-only Redis tidak menggagalkan readiness.
- [x] Login/bootstrap, public user DTO, refresh rotation, logout, dan authorization sesuai registry/permission diuji melalui HTTP nyata.
- [x] Default memory limiter bekerja untuk satu instance; pilihan Redis menyediakan service/URL benar dan limiter shared diuji pada dua instance.
- [x] Local upload berhasil; S3 profile mempunyai bucket dan upload berhasil; opsi custom provider env tidak ditimpa adapter.
- [x] Notifikasi tersimpan, penerima lain ditolak, mark-read dan SSE bekerja; SMTP mati tidak memerlukan mail server. Jalur SMTP aktif diuji dengan server fixture dan konfigurasi TLS yang memang didukung.
- [x] Proyek generated masing-masing build image dan start Compose, termasuk Redis/S3 profiles; migration failure mencegah API dimulai dan seed tetap eksplisit.
- [x] Mode manual dengan env loader/command yang dicetak CLI berjalan menggunakan dependency lokal CI; migration bukan efek samping API startup.

### 7.3 Pipeline dan publikasi

1. Job package: checkout bersih, recursive submodules, install CLI deterministik, typecheck/test, prepare snapshot, pack aktual, inventory scan. Upload `.tgz` dan manifest/hash sebagai artifact.
2. Job consumer matrix: Windows/Linux × empat template, ditambah smoke CLI macOS. Unduh artifact yang sama, install CLI, scaffold dari working directory di luar checkout, kemudian jalankan gate compile/contract.
3. Job service/Compose Linux: jalankan database/Redis/S3/SMTP fixture dan acceptance pada generated projects. Batas concurrency menjaga biaya/RAM build Go/MinIO tetap terkendali.
4. Job release: hanya sesudah semua required jobs lulus. Publikasikan `.tgz` yang telah diuji, bukan membangun ulang snapshot berbeda di job publish. Gunakan trusted publishing bila konfigurasi publisher npm tersedia; approval publish mengikuti permintaan pengguna.
5. Sesudah publish, cek registry version/integrity dan smoke `@<versi-baru>` serta `@latest` dari fresh directory. Versi baru dipilih berdasarkan compatibility perubahan, termasuk perubahan default Go `3000` → `8080`; jangan menentukan patch hanya dari nomor lama.
6. Simpan checklist hasil aktual dan outstanding gates. Gate yang belum dijalankan tidak diberi status lulus. Bila versi lama akan dideprecate karena risiko `.gitignore`, siapkan notice faktual dan minta otorisasi sebelum mengubah metadata versi publik.

## 8. Urutan pengerjaan dan kriteria selesai

1. **A lebih dahulu:** tutup risiko `.gitignore`, entrypoint hilang, dan graph file `.NET`. Paket harus dapat dibangun dari source Git sebelum QA diperluas.
2. **B lalu C:** selesaikan descriptor/parser/env/preflight, kemudian framework adapters dan source lifecycle/import/launcher.
3. **D:** selaraskan port, service opsional, setup manual/Docker, dan dokumentasi hasil generation.
4. **QA:** tambah regression untuk temuan CLI-01 sampai CFG-05 dan jalankan matrix artifact + integration. Regenerate snapshot dari commit yang sudah diuji.
5. **Rilis:** tulis hasil verifikasi, review diff, commit/push bila diminta, kemudian publish artifact yang sama setelah otorisasi rilis.

Pekerjaan dianggap selesai bila seluruh temuan P0/P1 tertutup dengan bukti, seluruh command yang dijanjikan pada generated project bekerja, empat template lolos required package/runtime/Compose gates, dan paket publik baru melewati smoke registry. Error yang berasal dari runtime terlalu lama, port terpakai, DB belum tersedia, atau network install dibedakan dengan jelas dari bug template.

## 9. Referensi resmi

- Pemisahan opsi initializer dan npm: [npm init/create](https://docs.npmjs.com/cli/v11/commands/npm-init/).
- File distribution, ignore, dan executable metadata: [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
- Lifecycle generation dan import Prisma 7: [Generating Prisma Client](https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client).
- Default contoh server NestJS `3000`: [NestJS first steps](https://docs.nestjs.com/first-steps).
- Container ASP.NET HTTP `8080`: [Microsoft container port compatibility](https://learn.microsoft.com/en-us/dotnet/core/compatibility/containers/8.0/aspnet-port).
- Go module/toolchain contract: [go.mod reference](https://go.dev/doc/modules/gomod-ref).
- Parsing dan interpolasi env Docker: [Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
