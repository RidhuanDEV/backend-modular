# Kontribusi

1. Buat branch dari `main` dan jaga perubahan tetap fokus.
2. Untuk kontrak API, periksa registry dan DTO Huma serta catat dampak parity keluarga template.
3. Untuk SQL, ubah query source dan migration, lalu generate sqlc; jangan mengedit file generated secara manual.
4. Tambah atau perbarui unit/integration/contract coverage yang sesuai.
5. Jalankan `go fmt`, `go vet ./...`, dan tes relevan. Tes database/Redis memerlukan layanan disposable; jelaskan bila gate integration tidak dijalankan.
6. Jangan sertakan `.env`, kredensial, data upload, atau artefak build.

Rincian perintah ada di [panduan testing](docs/testing.md), alur fitur di [panduan modul](docs/module-guide.md), dan aturan kontrak di [contract parity](docs/contract-parity.md).
