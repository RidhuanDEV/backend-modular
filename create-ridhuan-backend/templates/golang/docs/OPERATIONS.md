# Operasi template Go

## Rilis dan rollback

1. Build image dari revision yang sudah lolos verify; simpan tag immutable dan versi konfigurasi.
2. Backup database dan objects, kemudian jalankan `migrate` sebagai satu job rilis. Jangan menjalankan migrasi dari setiap replica. Compose sudah menunggu job sukses.
3. Jalankan replica baru; probe `/live` untuk proses dan `/ready` untuk PostgreSQL serta Redis rate store. Seed hanya lewat perintah eksplisit, dengan kredensial bootstrap yang segera diganti.
4. Rollback image hanya jika aplikasi lama kompatibel dengan schema baru. Gunakan migrasi expand/contract untuk perubahan berikutnya. Jangan otomatis menjalankan Goose down terhadap database production.

SIGTERM menguras request HTTP sampai 10 detik sebelum menutup dependency. Sesuaikan termination grace deployment menjadi lebih panjang dari batas tersebut. Request normal dibatasi 30 detik; shutdown timeout memaksa koneksi ditutup dan menghasilkan error.

## Backup dan restore

Gunakan `pg_dump --format=custom --file=backend.dump` dengan koneksi dari secret manager atau environment. Lindungi arsip seperti database asli; jangan memasukkan password ke Git atau perintah yang tercatat di log. Simpan versi migrasi dan waktu backup.

Backup bucket S3 atau direktori upload melalui mekanisme storage provider. Untuk pasangan database/object yang konsisten, hentikan mutasi upload selama snapshot keduanya atau gunakan backup versioned dan catat recovery point yang sama. Restore PostgreSQL ke database staging kosong dengan `pg_restore --exit-on-error --no-owner`; restore objects ke lokasi terpisah. Arahkan aplikasi staging ke database/bucket tersebut, jalankan readiness dan cek metadata upload menunjuk object yang ada. Jangan menimpa database production untuk latihan restore.

`go run ./cmd/cleanup-uploads` adalah dry run orphan pada storage yang dipilih melalui `UPLOAD_STORAGE`. Review daftar sebelum `--apply`; object baru dan object yang masih direferensikan dilindungi. Mode S3 memakai pagination ListObjectsV2 dan memerlukan izin list/delete bucket; mode lokal membaca direktori upload. Kegagalan kompensasi upload muncul di log dan perlu direkonsiliasi. Jangan memakai aturan lifecycle yang menghapus object aktif tanpa mengecek referensi database.

## Dependency dan konfigurasi

- PostgreSQL gagal: `/live` tetap hidup, `/ready` gagal; operasi bisnis gagal. Investigasi koneksi/pool/provider, jangan menonaktifkan audit required untuk menyembunyikan kegagalan.
- Redis untuk cache saja: request fallback ke DB; readiness tidak gagal. Invalidation gagal bisa meninggalkan cache stale sampai TTL 30 detik. Auth/grant selalu dibaca dari DB sebelum cache.
- Redis untuk rate limit: readiness gagal ketika Redis gagal. Endpoint auth fail closed dengan 503; public/internal fail open dan mencatat warning. Untuk lebih dari satu instance, gunakan Redis rate store.
- S3 gagal: operasi upload gagal. MinIO Compose untuk pengujian lokal; pilih object storage production yang dikelola dan dukung backup/versioning sesuai kebutuhan.
- `ENDPOINT_POLICIES_JSON`, rate groups, CORS, storage dan cache berubah melalui env lalu redeploy. Semua ID endpoint harus terdaftar dan override divalidasi saat startup.

## Secrets, proxy dan observability

Production perlu JWT secret acak, PostgreSQL/S3/Redis credentials, TLS ingress dan origin CORS eksplisit. `JWT_ISSUER`/`JWT_AUDIENCE` opsional: bila mulai diaktifkan, token lama tanpa claims tersebut ditolak dan pengguna perlu login ulang. Jangan gunakan password bootstrap contoh. Set `TRUST_PROXY_HOPS` sesuai jumlah proxy yang benar-benar dipercaya dan cegah akses langsung melewati ingress.

Access token berlaku 15 menit. Refresh token disimpan sebagai SHA-256 hash di tabel `auth_refresh_tokens`, dirotasi satu kali pakai, dan memiliki expiry absolut 30 hari sejak login. Replay atas refresh token yang sudah dicabut membatalkan seluruh family dan membuat permintaan refresh ditolak. Access token lama tanpa claim `tokenUse` ditolak setelah upgrade; pengguna perlu login sekali lagi. Jadwalkan pembersihan berkala untuk baris kedaluwarsa (`DELETE FROM auth_refresh_tokens WHERE expires_at < now()`); jangan mencatat token mentah. Login dan refresh memakai auth rate limiter. Untuk beberapa replica, `APP_INSTANCE_COUNT` harus sesuai kapasitas dan `RATE_LIMIT_STORE=redis`; endpoint auth fail closed dengan 503 saat Redis limiter unavailable.

Log JSON menyimpan request ID, operation ID, actor ID, status dan durasi tanpa body/password/token. Audit memakai projection bertipe dan redaction tambahan. OTel saat ini membungkus HTTP; ini tidak otomatis membuktikan span PostgreSQL, Redis atau S3. Hindari label dengan ID pengguna/URL dinamis dan amankan collector.

Sebelum deployment tertentu disebut siap production, uji restore backup, load sesuai target, alerting, outage/recovery, secret rotation, TLS/proxy serta storage durability di staging. Gate template lokal tidak membuktikan SLA atau kapasitas VPS.
