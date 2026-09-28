# Panduan membuat modul

Panduan ini memakai alur dan nama package yang benar-benar digunakan project. Contoh resource `invoice` perlu disesuaikan dengan kebutuhan aplikasi Anda.

## 1. Tambahkan migration Goose

Buat file berurutan berikutnya di `internal/db/migrations`, misalnya `00004_invoices.sql`. Nomor harus unik; jangan gunakan kembali versi yang sudah ada. Tambahkan bagian `-- +goose Up` dan `-- +goose Down`. Gunakan constraint, foreign key, index, dan `timestamptz` sesuai kebutuhan. Migration ter-embed oleh `internal/db`; jalankan `go run ./cmd/migrate` pada database lokal/disposable untuk menerapkannya.

Jangan edit migration yang telah dipakai bersama oleh deployment. Buat migration baru dengan strategi expand/contract agar versi aplikasi lama dan baru dapat berjalan selama rollout.

## 2. Tulis query dan generate sqlc

Tambahkan query bernama di `internal/db/queries/invoice.sql`. Ikuti pola query parameterized dan projection yang dipakai modul lain. Generate kode dari root repository:

```sh
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
```

Perintah ini sama di PowerShell, Linux, dan macOS; `make` tidak dibutuhkan. Kode hasil generate berada di `internal/db/sqlc`. Jangan edit file generated secara manual.

Tambahkan mapping database ke API/domain type di `internal/db/projection` bila row sqlc tidak boleh keluar sebagai DTO. Tambahkan tipe yang aman dan tanpa credential di `internal/model` bila dipakai lintas package.

## 3. Buat use case package

Buat package fitur, misalnya `internal/invoice`. Letakkan validasi input, operasi query, transaksi, dan audit di service/use case. Ikuti error bertipe di `internal/fault`. Untuk write yang audit-nya wajib, tulis perubahan dan audit di transaksi yang sama melalui pola `internal/audit`.

Jangan mengimpor `internal/httpapi` ke dalam service. Handler menerjemahkan request ke input service; ia tidak menjadi tempat aturan domain atau SQL.

## 4. Wire-kan service

Tambahkan service ke `internal/app/services.go` dan rangkai dependensinya di `internal/app.New`. `cmd/api` menjadi entrypoint composition root. Pertahankan dependency konkret yang sudah dipakai repository; jangan menambahkan generic repository tanpa kebutuhan.

## 5. Daftarkan DTO, handler, dan endpoint

Tambahkan request/response DTO pada `internal/httpapi` dengan tag yang dimengerti Huma untuk path, query, format, range, enum, dan body. Tambahkan fungsi `mountInvoice` pada file handler fitur. Gunakan helper generik `register[Input, Output]` sehingga endpoint runtime sekaligus masuk OpenAPI.

Tambahkan pemanggilan mount ke `Server.mount()` di `internal/httpapi/routes.go`. Daftarkan ID unik, method, path, module, summary, permission, public/private, audit mode, cache mode, rate group, dan status pada `Definitions` di `internal/httpapi/registry.go`. Semua endpoint harus tercatat di registry; pendaftaran Huma juga mendeteksi endpoint duplikat atau tidak terpasang.

Untuk endpoint privat, tentukan permission spesifik modul, seed permission tersebut dan kaitkan ke role admin pada `cmd/seed/main.go` serta query seed. Jangan menggunakan `manage_users` untuk fitur yang tidak mengelola user. Auth endpoints publik seperti login/refresh tetap wajib memakai rate group `auth`.

## 6. Tentukan audit, rate limit, cache, dan upload policy

Pilih audit `required`, `optional`, atau `none` berdasarkan kebutuhan. Required cocok untuk perubahan yang wajib punya jejak; optional tidak boleh membatalkan commit ketika audit gagal. GET tidak dapat memakai `required` sebelum tersedia producer read-audit yang sesuai.

Pilih rate group yang sudah ada (`auth`, `public`, `internal`). Quota masing-masing diatur oleh `RATE_LIMIT_<GROUP>_WINDOW_MS` dan `RATE_LIMIT_<GROUP>_MAX`; untuk membuat group baru perlu perubahan typed config, bukan hanya menambah nama env.

Cache memakai `read` atau `off`, hanya untuk GET. Perubahan endpoint/policy dilakukan melalui `ENDPOINT_POLICIES_JSON` dan memerlukan restart/redeploy. Uji authorization tetap membaca grant dari database ketika response berasal dari cache.

## 7. Perbarui verifikasi

Tambahkan unit test untuk aturan use case dan integration test bila mengubah transaksi, SQL, audit, atau storage. Tambahkan pemeriksaan bentuk/status OpenAPI dan response untuk endpoint baru.

Secara default, parity test Express Go mengharuskan daftar endpoint sama persis dengan fixture keluarga template. Menambah endpoint saja menyebabkan `TestExpressEndpointParity` gagal sampai kontrak keluarga disepakati dan fixture Go diperbarui. Jika aplikasi Anda memang memisahkan kontrak dari Express, hapus `TestExpressEndpointParity` dan fixture parity dari fork; pertahankan test lokal untuk registry/OpenAPI dan API behavior.

Jalankan focused tests, lalu gates dari [panduan testing](testing.md). Untuk perubahan contract, update [catatan parity](contract-parity.md) agar keputusan yang disengaja tetap terlihat.
