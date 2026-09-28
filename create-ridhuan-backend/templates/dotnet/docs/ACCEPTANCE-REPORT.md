# Laporan penerimaan lokal

Tanggal: 26 September 2026. Target sumber: `modular-NET`. Laporan ini menjelaskan bukti lokal template asal; project hasil initializer harus menjalankan gate sendiri.

## Implementasi

Template menggunakan SDK Microsoft .NET 10.0.401, runtime 10.0.12 dan paket NuGet publisher terkait. Rincian versi, penerbit dan lisensi tersedia di `DEPENDENCIES.md`. Tidak ada implementasi pengganti untuk EF Core, JWT handler, Identity password hashing, AWS SDK, Redis client, OpenAPI generator atau template engine Microsoft.

27 endpoint terdaftar dengan kontrak bertipe, pemeriksaan registry saat startup, autentikasi dan RBAC dari database, migrasi PostgreSQL terpisah, audit transaksional, Redis limiter/cache, local/S3 storage, cleanup orphan, konfigurasi deployment, Docker/Compose dan initializer tersedia. Perbedaan terhadap sumber Express/Go dijelaskan dalam `CONTRACTS.md`; kesetaraan respons byte demi byte tidak diklaim.

## Bukti yang dijalankan

| Gate | Hasil dan batas bukti |
| --- | --- |
| Restore paket terkunci | Berhasil dengan lock files dan sumber nuget.org |
| Release build terakhir Windows | Berhasil, 0 warning dan 0 error |
| Format | Diterapkan melalui dotnet format dan diverifikasi tanpa perubahan |
| Unit Windows | 4 lulus, 0 gagal/skip, `tests/ModularBackend.UnitTests/TestResults/final.trx` |
| Contract Windows | 3 lulus, 0 gagal/skip, `tests/ModularBackend.ContractTests/TestResults/final.trx`; registry, kebijakan startup, OpenAPI dan envelope |
| Integrasi Windows terakhir | 13 lulus, 0 gagal/skip, `tests/ModularBackend.IntegrationTests/TestResults/final.trx` |
| Linux sumber | Snapshot sebelum dua tes tambahan dan penyempurnaan cache/kompensasi terakhir: 4 unit + 3 contract + 11 integrasi lulus; `artifacts/linux-results/*.trx` |
| Linux hasil initializer | Snapshot tersebut: generated build dan 4 unit + 3 contract + 11 integrasi lulus; `artifacts/linux-results/generated/*.trx` |
| Initializer Windows | Project baru berhasil dibuat/restored/dibuild; 4 unit + 3 contract lulus; paket diperiksa tanpa `.env`, `.git`, output build atau uploads |
| OpenAPI | 8 dokumen hasil generator build; spesifikasi penuh memuat 27 operasi; multipart upload dan envelope diperiksa |
| Docker default | Image berhasil dibuild; migrator selesai; HTTP live/ready/health/docs/spec/login/RBAC/proyeksi user berhasil |
| Docker profil Redis/S3 | Login 200, readiness 200, daftar user 200, upload PDF dengan MIME yang benar 201 dan metadata 200. Image snapshot sebelum perubahan cache/kompensasi terakhir; source terbaru diuji oleh suite Windows. App dikembalikan ke konfigurasi default setelah smoke |
| Audit dependency | Audit paket langsung dan transitif melaporkan 0 vulnerability yang diketahui saat dijalankan; bukan jaminan bebas vulnerability |

Integrasi menggunakan PostgreSQL, Redis dan S3-compatible MinIO nyata, bukan hanya mocks. Skenario mencakup CRUD, seed idempotent, migrasi fresh/upgrade yang menjaga data, rollback audit wajib, audit opsional, perubahan grant pada JWT lama, soft delete, konflik xmin, limiter lintas client/expiry/outage, cache rusak/outage/invalidation, S3 roundtrip, kompensasi upload, orphan dry run/apply, batas ukuran/signature, CORS/readiness dan penolakan JWT tidak sah. Database tes dibuat terpisah dengan nama acak dan dibersihkan.

Docker Desktop sempat mengembalikan 500/EOF. Layanan kemudian pulih; suite Windows terakhir lulus penuh. CLI Linux terputus, tetapi container menyelesaikan pekerjaan dan TRX yang terpasang di host menunjukkan semua tes snapshot Linux lulus. Hasil yang sempat gagal akibat layanan mati tidak dihitung sebagai lulus.

Verifikasi ulang initializer menemukan konflik identitas template dari instalasi lokal berulang. Initializer diperbaiki agar setiap invocation memakai lokasi `DOTNET_CLI_HOME` terpisah untuk engine template resmi; hasil project baru berhasil dibuild dan tujuh tes unit/contract lulus. Instalasi template manual di README tetap memakai CLI standar.

## Gate eksternal yang belum dijalankan

- Workflow GitHub Actions tersedia; hasil remote belum diverifikasi dalam laporan lokal ini. Periksa run setelah source dipush.
- Snapshot Linux belum menguji dua tes tambahan serta perubahan terakhir yang sudah lulus pada Windows.
- Uji staging/production, beban/SLA, HA/failover, restore backup nyata, telemetry delivery ke collector dan kebijakan retention organisasi belum diverifikasi.
- Compose memiliki dependency migrator selesai sukses; simulasi deployment dengan migrasi gagal belum dijalankan.
- MinIO digest historis digunakan hanya sebagai fixture development/integrasi; pilihan layanan S3 production harus ditetapkan sesuai runbook.

## Git dan rahasia

Origin: `https://github.com/RidhuanDEV/NET-backend.git`. Branch: `codex/bootstrap-template`. `.gitignore` mengecualikan `.env`, hasil build, hasil tes dan artifacts. `.env.example` berisi placeholder. `.env` lokal memakai rahasia acak dan tidak menjadi isi paket template. User mengizinkan commit/push pada 26 September 2026. Publikasi paket dan deployment production belum dilakukan.
