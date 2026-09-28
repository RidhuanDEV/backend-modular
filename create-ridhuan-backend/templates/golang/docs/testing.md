# Testing dan pemeriksaan template

## Pemeriksaan lokal

```sh
gofmt -w $(find cmd internal -name '*.go')
go vet ./...
go test ./...
```

PowerShell untuk format file Go:

```powershell
$files = rg --files cmd internal -g '*.go'
gofmt -w $files
go vet ./...
go test ./...
```

`go test ./...` tanpa `DATABASE_URL` melewati tes integrasi PostgreSQL; itu bukan bukti bahwa database behavior lulus. Redis integration checks juga perlu Redis. Gunakan database/Redis disposable. Migration upgrade test membuat database terisolasi dan memerlukan role PostgreSQL dengan `CREATEDB`.

## Query generation

`sqlc` dipin ke v1.31.1 pada target `make sqlc`. Tanpa `make` (termasuk Windows PowerShell), gunakan:

```sh
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
```

Sesudah generate, periksa perubahan di `internal/db/sqlc` dan pastikan query source yang sesuai ada di `internal/db/queries`.

## Verifikasi proyek hasil initializer di Linux

Script ini membuat project sementara, menjalankan tes/build/migrasi, lalu memeriksa HTTP dari binary. Ia memerlukan Linux dan `DATABASE_URL` ke PostgreSQL disposable dengan izin `CREATEDB`. Sediakan `REDIS_URL` untuk tes Redis. Docker daemon tidak diperlukan oleh script ini:

```sh
GOMAXPROCS=2 GOMEMLIMIT=512MiB GOFLAGS=-p=1 sh scripts/verify-linux-initializer.sh
```

Batas `GOMAXPROCS`, `GOMEMLIMIT`, dan `GOFLAGS` membatasi compile di runner; bukan setting memori runtime API.

## Docker dan CI

CI menjalankan Go tests, race checks, generation drift, vulnerability scan, initializer smoke, dan Compose integration gates sesuai workflow di `.github/workflows/ci.yml`. Compose smoke memakai layanan disposable termasuk PostgreSQL dan profile Redis/MinIO. Build Docker dapat menggunakan cache BuildKit dan membatasi compile untuk runner dengan memori kecil.

Jalankan [runbook operasi](OPERATIONS.md) untuk membedakan bukti lokal, service integration, dan kesiapan deployment production.
