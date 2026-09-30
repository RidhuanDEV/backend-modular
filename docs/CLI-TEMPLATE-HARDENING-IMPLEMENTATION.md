# Hasil Implementasi Hardening CLI Empat Template

Tanggal: 30 September 2026.
Status: perbaikan source diterapkan dan dipush ke main; verifikasi lokal lulus; calon rilis CLI 1.2.0 disiapkan. Publikasi npm belum dilakukan.

## Ringkasan perubahan

| Temuan rencana | Perbaikan |
| --- | --- |
| CLI-01, CLI-02 | Entrypoint source dikecualikan dari ignore build; paket membawa `gitignore.template` yang dipulihkan menjadi `.gitignore` sebelum secret dan Git init. |
| NET-01, NET-02, NET-03 | Seluruh tools, solution, lockfiles dan template NuGet disertakan; rename mencakup Python/PowerShell dan nama dependency project pada lockfile; launcher membaca env dan memakai SDK pada PATH. |
| EXP-01, EXP-02 | Prisma generate menjadi lifecycle build/dev; verifikasi aplikasi terpisah dari initializer Express lama. |
| ENV-01 | Serializer menghindari interpolasi/komentar env, mengencode URI PostgreSQL dan mengquote connection string Npgsql. Loader tiap framework menjaga literal quote, backslash, dollar dan Unicode serta mendahulukan injected env. Newline/NUL ditolak. |
| CFG-01, CFG-02, CFG-03 | Profile otomatis sesuai pilihan Redis/S3; bucket MinIO diprovisikan oleh job terpisah; endpoint host/container terpisah; opsi provider S3 tidak ditimpa. S3Mock .NET menggunakan versi 5.2.2 yang diuji. |
| CLI-03, CLI-04, CLI-05, CLI-06 | Driver PostgreSQL menguji autentikasi dan SELECT; preflight mengikuti manifest framework/mode; Go child process memakai GOWORK=off; parser menolak input salah sebelum write; password tersamarkan; exit cancellation 130; install gagal menyisakan proyek dan instruksi pemulihan. |
| CFG-04, CFG-05, DOC-01, DOC-02 | Nama package/lockfile, port, launcher, metadata npm, banner dan next steps diselaraskan; panduan hasil generation mencakup migrate/seed/manual/Docker/hybrid. |
| QA-01, PKG-01 | Snapshot dari daftar eksplisit dengan commit/hash manifest, normalisasi LF lintas OS dan penolakan source dirty untuk release; pengujian menginstall tarball di luar repo; CI memeriksa artifact yang sama sebelum publish. |

Tambahan dari uji runtime: NestJS meneruskan kredensial seed ke Compose dan membatasi waktu koneksi database. Redis cache Go memiliki batas waktu operasi dan client agar cache opsional tidak menahan request saat Redis terputus. Redis namespace Express/Go diisolasi per deployment, dengan namespace sama untuk seluruh replica deployment tersebut. Compose Express memakai mode production sesuai dependency image runtime.

Tidak ada perubahan kontrak HTTP/schema/migrasi untuk menutupi setup yang gagal. Express/NestJS tetap memakai `token`; .NET memakai `accessToken`; logout diuji hanya pada framework yang memang mendefinisikannya. NestJS tetap menggunakan class DTO, class-validator/class-transformer dan Swagger.

## Default

| Framework | HTTP manual/host | HTTP container | PostgreSQL host | Redis host | S3 development host |
| --- | --- | --- | --- | --- | --- |
| Express | 3000 | 3000 | 5432 | 6379 | 9000 |
| NestJS | 3000 | 3000 | 5432 | 6379 | 9000 |
| Go | 8080 | 8080 | 5432 | 6379 | 9000 |
| ASP.NET Core | 5080 | 8080 | 55432 | 56379 | 19000 |

`--port` mengganti port manual dan host; port container tetap. Redis/cache dan SMTP mati secara default; upload lokal dan memory limiter cocok untuk setup satu instance. Pilihan Redis mengaktifkan cache/shared limiter serta profile dependency. Konfigurasi dynamic berubah melalui env dan restart/redeployment.

## Verifikasi aktual

Semua consumer berasal dari tarball lokal terpasang di direktori sementara dengan spasi, di luar checkout. Verifikasi implementasi awal memakai tarball development yang dikemas setelah build eksplisit dengan `--ignore-scripts`. Setelah source framework di-commit dan dipush, snapshot dibuat ulang tanpa `--allow-dirty`; versi CLI dinaikkan menjadi `1.2.0` dan dikemas melalui lifecycle `npm pack` normal. Paket belum dipublikasikan.

| Pemeriksaan | Express | NestJS | Go | ASP.NET Core |
| --- | --- | --- | --- | --- |
| Install dan build proyek hasil tarball | Lulus | Lulus | Lulus | Locked restore + Release build lulus |
| Checks/generator | 15 tes + lint/docs + CRUD compile; tambahan 2 tes env loader lulus | 10 tes + Prisma/docs/contract + feature generator compile | Build/vet/test seluruh package; tes env dan bounded cache lulus | 4 unit + 3 contract; formatter source lulus |
| Manual API dengan PostgreSQL disposable | Migrate, seed, chosen port, env loader, health/docs dan login lulus | Lulus | Lulus | Lulus |
| Compose integration lengkap | Lulus | Lulus | Lulus | Lulus |

CLI juga lulus empat scaffold dari tarball, default/custom config, secret ignore, overwrite protection, invalid flags/port/module/path, target junction/symlink, cancellation, missing tool, failed install recovery, custom S3 provider serta invocation `npm exec` (resolver npx) dan `npm create`.

Compose integration mencakup migration failure dengan exit code 23 yang menahan API, database kosong/upgrade dengan data lama, seed dua kali, autentikasi/refresh/public DTO, authorization notifikasi dan recipient isolation, SSE, upload lokal dan S3, SMTP STARTTLS dan implicit TLS dengan CA khusus fixture, shared auth quota di dua replica, readiness/liveness saat DB/Redis gagal, serta cache-only Redis fallback. CA pengujian tidak dimasukkan ke template aplikasi.

Default startup menggunakan `docker compose up --build -d --wait`. Dependency opsional memakai `required: false` agar konfigurasi tanpa profile tetap valid; saat profile dipilih, `--wait` memeriksa servicenya. Dependensi migrasi selalu wajib dan menahan startup jika gagal. Seed tetap eksplisit.

## Menjalankan pemeriksaan

Di `create-ridhuan-backend`, gunakan Node yang didukung:

```sh
npm ci
npm run prepare:templates -- --allow-dirty
npm run build
npm test
node scripts/verify-consumer.mjs express-typescript --runtime
node scripts/verify-consumer.mjs nestjs --runtime
node scripts/verify-consumer.mjs golang --runtime
node scripts/verify-consumer.mjs dotnet --runtime
node scripts/verify-compose.mjs express-typescript
node scripts/verify-compose.mjs nestjs
node scripts/verify-compose.mjs golang
node scripts/verify-compose.mjs dotnet
```

Opsi `--runtime` dan integration Compose membutuhkan Docker untuk layanan fixture; pemeriksaan compiler saja tidak membutuhkan layanan eksternal. Pengujian memakai DB/container sendiri dan membersihkannya. `--keep` menyimpan direktori hasil untuk inspeksi. Set `CLI_TARBALL` untuk memverifikasi satu artifact tertentu.

## Gate rilis yang masih terpisah

1. Source submodule sudah di-commit dan dipush; pointer root/snapshot diperbarui tanpa `--allow-dirty`. Seluruh manifest mencatat source clean. Prepack release tetap menolak source dirty.
2. Jalankan workflow `CLI template consumers` dari clean recursive checkout: Windows/Linux consumer matrix, manual runtime Linux, macOS CLI smoke dan Linux Compose. Workflow telah ditambahkan; hasil CI remote belum tersedia.
3. Versi minor `1.2.0` sudah disiapkan, termasuk perubahan default Go menjadi 8080. Sesuaikan npm trusted publisher untuk workflow ini bila memakai rilis OIDC, lalu publish artifact yang telah melewati seluruh gate. Publish default workflow tetap nonaktif.
4. Sesudah publish, smoke npm registry untuk versi baru dan latest dari direktori baru. Paket publik 1.1.1 belum berubah oleh pekerjaan lokal ini.

Build/tes lokal ini membuktikan setup dan kontrak yang diperiksa. Pengujian CI remote, artifact dari commit final, dan smoke registry ditulis sebagai gate terpisah agar tidak dianggap sudah lulus.

## Commit framework yang digunakan snapshot 1.2.0

| Framework | Commit main |
| --- | --- |
| Express | `47754a699ab1147ed807971923546641a6e60aa5` |
| NestJS | `84c787a25432e6cecc05dcc2015ff93a447f0c5e` |
| Go | `2fdb3ca0d4b908ea978f20e5b6de9b8625ef9a87` |
| ASP.NET Core | `31b1d937905f5ea70f04140726e92a05181e5446` |

Hash setiap commit framework diverifikasi terhadap remote `refs/heads/main`.
