# Modular .NET Backend

Starter backend bertipe untuk tim yang membangun API baru dengan **ASP.NET Core 10, PostgreSQL atau MySQL**. Auth, permission, audit, upload, notifikasi, dan worker sudah terhubung agar Anda bisa fokus pada fitur aplikasi.

[English](README.md) · [Mulai](#quick-start) · [Docker](#docker) · [Struktur](#struktur-project) · [Dokumentasi](#upgrade-dan-dokumentasi)

## Fitur

- JWT dan refresh token opaque yang dirotasi; reuse mencabut keluarga sesi.
- Permission dibaca dari grant database terbaru, bukan data client.
- Audit wajib berada dalam transaksi yang sama dengan mutasi.
- Notifikasi tersimpan, SSE, dan worker outbox email dengan retry/lease.
- Upload lokal/S3, Redis cache/rate limit opsional, OpenAPI, dan health probe.
- Migrasi/seeder eksplisit dan history PostgreSQL/MySQL terpisah.
- Container non-root dan tes dengan database nyata, bukan pengganti SQLite.

## Kebutuhan

| Mode | Kebutuhan |
| --- | --- |
| Manual | SDK .NET 10.0.401, database aplikasi, PowerShell 7 atau Python 3 untuk env loader |
| Docker | Docker Engine/Desktop dengan Linux containers dan Compose v2 |
| Opsional | Redis, SMTP, atau S3 ketika fitur terkait diaktifkan |

Fixture Compose memakai PostgreSQL 18 dan MySQL 8.4; ini bukan klaim versi minimum untuk semua deployment.

## Quick start

Jika CLI sudah membuat project, gunakan GETTING-STARTED.md dan pertahankan .env yang berisi secret baru.

### 1. Atur environment

Linux/macOS:

```sh
cp .env.example .env
```

Windows:

```powershell
Copy-Item .env.example .env
```

Buat database khusus aplikasi. Isi Jwt__Secret, Bootstrap__Password, dan credential database yang cocok. .NET tidak membaca .env sendiri; scripts/run.ps1 atau scripts/run.py yang memuatnya. Jangan memakai placeholder untuk deployment.

### 2. Restore, migrate, seed, dan jalankan

```powershell
pwsh -File scripts/run.ps1 restore --locked-mode
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Migrator
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Seeder
pwsh -File scripts/run.ps1
```

Di Linux/macOS, ganti pwsh -File scripts/run.ps1 dengan python3 scripts/run.py dan pertahankan argumen lainnya. Migrasi dan seed tidak berjalan saat HTTP startup.

### MySQL

Salin .env.mysql.example, pilih provider MySQL, lalu isi credential. Jalankan urutan migrasi/seeder yang sama. Mengganti environment tidak mengonversi data PostgreSQL menjadi MySQL.

## Docker

Atur .env terlebih dahulu. PostgreSQL:

```sh
docker compose up --build -d --wait
docker compose --profile seed run --rm seeder
```

Checkout source MySQL:

```sh
docker compose -f compose.mysql.yaml up --build -d --wait
docker compose -f compose.mysql.yaml --profile seed run --rm seeder
```

Project MySQL hasil CLI sudah memakai provider pilihan sebagai file Compose aktif. Compose menunggu migrasi berhasil, menjalankan worker terpisah, dan mempertahankan seed sebagai perintah eksplisit.

## API documentation

Port default host/manual: **5080**. Container memakai **8080**.

| Path | Fungsi |
| --- | --- |
| /docs | Indeks tautan spesifikasi API |
| /docs/openapi.json | OpenAPI lengkap |
| /docs/specs/user.json | Contoh spesifikasi per modul |
| /live | Liveness HTTP tanpa mengandalkan database |
| /ready | Kesiapan dependency yang wajib |

Login/refresh memberikan data.accessToken dan data.refreshToken. Gunakan Authorization: Bearer untuk request terlindungi. Refresh memiliki sliding expiry; koordinasikan satu request refresh agar token lama tidak dipakai ulang.

## Struktur project

```text
src/ModularBackend.Api/            # HTTP, DTO binding, middleware, DI
src/ModularBackend.Application/    # Use case dan port eksplisit
src/ModularBackend.Domain/         # Entity tanpa dependency infrastruktur
src/ModularBackend.Infrastructure/ # EF Core, Redis, SDK storage/SMTP
tools/                            # Migrator, seeder, worker, cleanup, initializer
scripts/                          # Env loader lintas platform
tests/                            # Unit, contract, integration
docs/                             # Referensi, module guide, dan operasi
```

Api menangani HTTP; Application mengatur use case; Infrastructure mengimplementasikan port; Domain tidak bergantung pada framework. Starter memakai BackendService/BackendStore, bukan mengklaim semua fitur sudah menjadi folder modul terpisah.

## Konfigurasi dan operasional

- Semua pengaturan ada di .env.example/.env.mysql.example; perubahan memerlukan restart/redeploy.
- Multi-replica harus memakai limiter Redis. Cache Redis opsional dan kegagalannya tidak menggantikan authorization database.
- Notifikasi milik penerima; SSE memakai query singkat tanpa transaksi yang ditahan saat pengiriman.
- Worker email sudah tersedia. SMTP at least once dan dapat mengirim ulang setelah crash.
- Storage dan SQL bukan satu transaksi. Cleanup terpisah dan dry-run harus ditinjau sebelum --apply.
- TLS database, trusted proxy, CORS eksplisit, backup dan restore harus dikonfigurasi sesuai deployment.

Worker manual di terminal terpisah:

```powershell
pwsh -File scripts/run.ps1 run --project tools/ModularBackend.Worker
```

## Testing

```sh
dotnet restore --locked-mode
dotnet build -c Release --no-restore -warnaserror
dotnet format --verify-no-changes --no-restore
dotnet test ModularBackend.slnx -c Release --no-build
```

Tes integration memerlukan database nyata dan service terkait. Skip/inconclusive bukan lulus. CI yang lulus tidak membuktikan kapasitas, HA, atau pemulihan backup production.

## Upgrade dan dokumentasi

Baca upgrade guide **sebelum menerapkan migrasi ke data tersimpan**. Gunakan database aplikasi dengan pemilik migrasi yang jelas.

| Panduan | Fungsi |
| --- | --- |
| [Referensi teknis](docs/REFERENCE.id.md) | Kontrak, setting, contoh, dan detail asli dalam Bahasa Indonesia |
| [Hardening upgrade](docs/HARDENING-UPGRADE.md) | Sesi, SSE, outbox, retention, telemetry, dan rollout |
| [Tambah modul](docs/ADDING-MODULES.md) | Use case, DTO, registry, permission, dan migrasi EF |
| [Operations](docs/OPERATIONS.md) | Deployment, TLS, backup, dan restore |
| [Contracts](docs/CONTRACTS.md) | Perbedaan kontrak yang disengaja |
| [Dependencies](DEPENDENCIES.md) | Publisher, versi terkunci, dan lisensi provider |

## Lisensi

[MIT](LICENSE). [Contributing](CONTRIBUTING.md) dan [Security policy](SECURITY.md) menjelaskan kontribusi dan pelaporan kerentanan.
