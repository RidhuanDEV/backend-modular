# Status implementasi FastAPI dan PostgreSQL/MySQL

Tanggal: 1 Oktober 2026. Status: source tersedia dan sepuluh kombinasi Compose lokal lulus; belum dirilis.

## Perubahan yang tersedia

- FastAPI sebagai repo saudara `modular-fastapi`, dengan SQLAlchemy/Pydantic bertipe, Alembic terpisah per engine, auth/refresh, live RBAC, audit, upload, Redis opsional, notifications/SSE dan SMTP TLS.
- Express/NestJS menggunakan schema/migration Prisma dan adapter MySQL terpisah; Go menggunakan query/sqlc/Goose MySQL; .NET menggunakan provider resmi Oracle, context/migration MySQL terpisah dan concurrency token aplikasi.
- History PostgreSQL existing dipertahankan. Pilihan engine dicatat saat generation; perubahan env tidak mengonversi database berisi data.
- CLI menerima lima framework dan `--database postgresql|mysql`, memilih dependency/env/Compose/port yang sesuai, menulis marker provider dan membawa snapshot mandiri dengan hash/provenance.
- Initializer Go dan template/initializer .NET memahami pilihan engine. MySQL memakai akun aplikasi dan secret admin terpisah; bootstrap menangani password dengan kutip, backslash dan karakter non-Latin.
- CI root menyiapkan matriks consumer Windows/Linux, smoke macOS dan sepuluh Compose combinations. Source CI masing-masing juga memiliki gate MySQL.

## Bukti lokal yang sudah diperoleh

- Sepuluh pasangan framework/engine berhasil menghasilkan proyek dari tarball. Pengujian `npm exec` dan `npm create` terhadap tarball lokal juga lulus.
- Consumer Windows: build/test/generator lulus untuk seluruh pasangan; startup manual, migration, seed, port, docs dan login lulus untuk seluruh pasangan pada putaran consumer. FastAPI terbaru juga diuji kembali sesudah perubahan SSE/SMTP/cache dan generator.
- FastAPI PostgreSQL dan MySQL: migrasi awal dengan role/user/notifikasi contoh -> upgrade -> cursor backfill -> Alembic drift check lulus. Strict Pyright, Ruff dan delapan unit tests lulus; HTTP integration kedua engine lulus. Generator memformat file dengan Ruff; consumer memeriksa formatting tanpa memperbaiki output secara diam-diam.
- Seluruh sepuluh pasangan: Compose memverifikasi migration failure gate, fresh/upgrade, credentials, seed, auth/refresh/logout, public DTO, local/S3 upload, notifications/SSE, SMTP STARTTLS/implicit TLS, Redis limiter dua replica dan readiness saat DB/Redis mati.
- Pengujian ulang FastAPI Compose terbaru untuk kedua engine juga lulus.
- Go: test/vet tanpa layanan, PostgreSQL suite dengan database nyata, serta MySQL upgrade/UTC/transaction rollback lulus. Output initializer MySQL dibangun dan diuji dengan `GOWORK=off`.
- NestJS/MySQL: delapan HTTP integration tests lulus, termasuk pencarian case insensitive, wildcard literal, pagination/count dan required audit rollback.
- .NET: Release build, unit/contract, initializer/NuGet MySQL dan pemeriksaan model drift kedua engine lulus. HTTP integration PostgreSQL dan MySQL: masing-masing 13 lulus, tiga tes Redis/S3 dilewati ketika fixture tersebut tidak disediakan. Compose menguji Redis dan storage dengan fixture terpisah.
- FastAPI dependency audit: tidak ada vulnerability yang ditemukan pada dependency runtime terkunci. Go vulnerability scan: tidak ada call yang terdampak; satu advisory dependency yang tidak dipanggil masih tercatat oleh scanner.

Log pengujian bersifat lokal dan diabaikan Git. Hasil ini tidak membuktikan load production, backup restoration atau deployment pengguna.

| Framework | PostgreSQL Compose | MySQL Compose | Default HTTP host | Default DB host |
| --- | --- | --- | --- | --- |
| Express | Lulus | Lulus | 3000 | 5432 / 3306 |
| NestJS | Lulus | Lulus | 3000 | 5432 / 3306 |
| Go | Lulus | Lulus | 8080 | 5432 / 3306 |
| ASP.NET Core | Lulus | Lulus | 5080 | 55432 / 3306 |
| FastAPI | Lulus | Lulus | 8000 | 5432 / 3306 |

## Artifact dan perbaikan pada putaran terakhir

- Express/MySQL sebelumnya gagal pada Docker build API docs karena URL placeholder build masih PostgreSQL. `Dockerfile` sekarang memilih scheme dari `DB_PROVIDER`; Express kedua engine kemudian lulus Compose.
- FastAPI generator menggunakan alias import untuk nama modul seperti `settings`, memperbarui registry/contract, menolak collision model, dan memformat output otomatis. Consumer kedua engine lulus tanpa auto-fix dalam test, membuat migration provider melalui command native, melakukan drift check, lalu memanggil kedua endpoint hasil generation.
- CLI lokal `1.4.0`: sepuluh generation/default/ignore/lockfile gates lulus, termasuk eksekusi tarball melalui npm exec/npm create. Inventory akhir berisi 621 file dan seluruh lima manifest/checksum telah diperiksa; `npm pack --dry-run` cocok dengan paket aktual.
- Putaran lokal memakai beberapa development artifact saat perbaikan berlangsung. Artifact Compose awal memiliki SHA-256 `92645e1d8bd2152647b7b8e30b698220d5ceae39a3097d4842b3b2b4e16e00ed`; Express dan recheck FastAPI memakai `ade3fc30bd2fccd60fa22823c54856670fa6a728a7009209510364d9db0c799b`; consumer generator terbaru memakai `d619dd94f15a5488f6e85554ed9e7a706fdedc4a12a293eabbff985aa6799f13`.
- Paket pengembangan terakhir setelah pembaruan dokumentasi memiliki SHA-256 `b757aa5bac26c7ef6e32054f0bbae2c97e0547fee8150032f6d45b007f9286ab`. Ini bukan artifact clean untuk publikasi. Required CI harus menguji satu artifact clean yang sama sebelum rilis.
- Go scanner tidak menemukan vulnerability yang reachable. Advisory module-only `GO-2026-5932` berada pada `golang.org/x/crypto/openpgp` yang tidak diimpor aplikasi; tidak berarti seluruh dependency bebas advisory.

## Gate yang masih terbuka

- CI source kelima framework pada commit fitur awal lulus. Root CI menemukan hook bootstrap MySQL yang mengubah shell entrypoint saat hook di-source di Linux; fix subshell sudah di-push ke kelima source dan snapshot CLI. Putaran CI terbaru sedang diverifikasi.
- Source kelima framework sudah di-commit dan di-push ke main atas instruksi pengguna. FastAPI sudah diregistrasikan sebagai submodule; snapshot CLI dibangun ulang dari source clean tanpa `--allow-dirty`.
- CLI `1.4.0` belum dipublikasikan oleh pekerjaan ini. Tidak ada deploy atau acceptance `npx @latest` untuk fitur baru ini. Publikasi tetap menunggu required CI terhadap satu artifact clean yang sama.

## Commit source dan build lokal sebelum push

| Source | Commit main | Gate lokal terakhir |
| --- | --- | --- |
| Express | `bd806af` | verify:template, build, test, API docs, Prisma validate |
| NestJS | `a0c0b72` | verify:template, build, 10 tests |
| Go | `2125414` | build, vet, test |
| .NET | `69db010` | Release build, format, 4 unit + 3 contract tests |
| FastAPI | `0cdab5d` | Ruff, strict Pyright, 8 unit tests, OpenAPI |

Build aplikasi dilakukan pada commit fitur sebelum fix hook; source aplikasi tidak berubah pada fix tersebut. Regresi hook MySQL terbaru diuji terhadap image resmi dengan mode Linux `0644` (sourced) dan `0755` (executable): keduanya berhasil startup dan mengautentikasi password kutip/backslash/Unicode. Pengujian CLI clean sepuluh pasangan juga lulus kembali.

GitHub Actions source dan root akan dicatat setelah hasil run terbaru tersedia.

## Reproduksi

Di folder `create-ridhuan-backend`, untuk verifikasi pengembangan:

```sh
npm ci
npm run prepare:templates -- --allow-dirty
npm run build
npm test
node scripts/verify-consumer.mjs fastapi mysql --runtime
node scripts/verify-compose.mjs fastapi mysql
```

Ganti framework/engine untuk pasangan lain. Set `CLI_TARBALL` ke path absolut `.tgz` yang sama ketika menguji matrix artifact. `--allow-dirty` hanya untuk pengujian lokal; jangan menerbitkan snapshot tersebut.
