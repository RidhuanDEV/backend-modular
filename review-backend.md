# Review Backend Templates

Tanggal: 2026-10-18 · Level: medium · Reviewer: Claude (Opus 5.5)

## Ruang lingkup

Repo sekarang berisi **7 template backend**: Express, NestJS, Go, .NET, FastAPI, Laravel, Spring Boot.

- Express, NestJS, Go dan .NET sudah di-review dan diperbaiki sebelumnya (2026-09-30: aturan anti-eskalasi, timing login, error mapping, dan sebagainya).
- Review ini fokus pada **tiga template baru** (FastAPI, Laravel, Spring Boot), di jalur berisiko tinggi: auth, refresh token, RBAC/privilege, dan error handling. Ditambah pengecekan regresi pada error filter NestJS.
- Tidak ada diff yang belum di-commit selain dua file docs, jadi review dilakukan terhadap kode di `main`.
- **Belum diverifikasi:** tidak ada test yang dijalankan untuk review ini. Setiap temuan berasal dari membaca kode dan menyebut file serta baris yang perlu dicek.

## Ringkasan

| Template | Status | Catatan utama |
|---|---|---|
| FastAPI | Bagus | JWT dipin, login timing-safe, email dinormalisasi, aturan privilege ada. Refresh session bisa diperpanjang tanpa batas. |
| Laravel | Perlu perbaikan | Admin tidak bisa memberi permission baru; password > 72 byte memicu 500; email tidak dinormalisasi (PostgreSQL). |
| Spring Boot | Perlu perbaikan | Admin tidak bisa memberi permission baru; error DB ditelan tanpa log. |
| Express, NestJS, Go, .NET | Sudah diperbaiki | Error filter NestJS kembali hanya mencatat tipe error. |

## Temuan

### [HIGH] 1. Laravel: admin tidak bisa memberi permission yang dibuat setelah seed
**Lokasi:** `modular-laravel/app/Modules/Users/Policies/AccessPolicy.php:30-44`

`within()` mewajibkan setiap permission yang diberikan sudah dimiliki actor, tanpa pengecualian untuk role root. Seed hanya memberi admin permission yang ada saat seed dijalankan, dan `PermissionService` tidak otomatis memberi permission baru ke admin.

**Skenario gagal:** admin membuat permission `manage_invoices` lalu mencoba `POST /api/roles/{id}/permissions` → **403**. Admin juga tidak bisa mengubah atau menghapus role yang sudah memegang permission itu. Ini bug yang sama yang tertangkap oleh test .NET di template lain.

**Perbaikan:** samakan dengan template lain, yaitu role seed `admin` dikecualikan.
```php
public const ROOT_ROLE = 'admin';

public function within(User $actor, array $ids): void
{
    $role = Role::query()->with('permissions')->find($actor->role_id)
        ?? throw new ApiException(403, 'Actor role is unavailable');
    if ($role->name === self::ROOT_ROLE) {
        return;
    }
    // ... cek array_diff seperti sekarang
}
```
Tambahkan juga test: admin membuat permission baru → memberikannya ke role → 200.

### [HIGH] 2. Spring Boot: admin tidak bisa memberi permission yang dibuat setelah seed
**Lokasi:** `modular-springboot/src/main/java/com/example/backend/platform/security/Access.java:52-64`

`within()` dan `grant()` tidak punya pengecualian untuk root role (seed menamainya `ADMIN`). Dampaknya sama dengan temuan #1.

**Perbaikan:**
```java
private static final String ROOT_ROLE = "ADMIN";

private boolean isRoot(UUID actor) {
  return jdbc.queryForObject(
      "SELECT r.name = ? FROM roles r JOIN users u ON u.role_id = r.id WHERE u.id = ?",
      Boolean.class, ROOT_ROLE, actor);
}

public void within(UUID actor, UUID role) {
  if (isRoot(actor)) return;
  if (!permissions(actor).containsAll(rolePermissions(role))) throw ApiException.denied();
}
```
Terapkan cek yang sama di awal `grant()`.

### [MEDIUM] 3. Laravel: password lebih dari 72 byte menghasilkan 500
**Lokasi:** `modular-laravel/app/Modules/Auth/Http/Requests/RegisterRequest.php:18`, `.../Users/Http/Requests/CreateUserRequest.php:18`, `config/hashing.php:7`

`config/hashing.php` memakai `'limit' => 72`. `BcryptHasher::make()` di Laravel melempar `InvalidArgumentException` untuk input yang lebih panjang, sedangkan aturan validasi hanya `min:6`. Exception handler memetakan `InvalidArgumentException` ke 500.

**Skenario gagal:** `POST /api/auth/register` dengan password 80 karakter → **500 Service unavailable**, padahal seharusnya 422.

**Perbaikan:** tambahkan aturan batas byte di kedua request:
```php
'password' => ['required', 'string', 'min:6',
    fn ($attr, $value, $fail) => strlen($value) > 72 ? $fail('Password must be at most 72 bytes.') : null],
```

### [MEDIUM] 4. Laravel: email tidak dinormalisasi, jadi di PostgreSQL bisa terdaftar dua kali
**Lokasi:** `modular-laravel/app/Modules/Auth/Http/Requests/RegisterRequest.php:28`, `database/migrations/postgresql/2026_10_03_000001_create_core.php:34`

Email disimpan apa adanya. Unique index di PostgreSQL case-sensitive (MySQL tidak, karena collation-nya).

**Skenario gagal (PostgreSQL):** `Admin@Example.com` dan `admin@example.com` jadi dua akun terpisah, dan login dengan huruf kapital yang berbeda gagal.

**Perbaikan:** normalisasi di `dto()` milik semua request yang menerima email (register, login, create/update user), misalnya `Str::lower(trim(Input::string($v, 'email')))`. FastAPI dan Spring sudah melakukan ini.

### [MEDIUM] 5. FastAPI, Laravel, Spring: refresh session bisa diperpanjang tanpa batas
**Lokasi:**
- `modular-fastapi/src/app/modules/auth/service.py:141`
- `modular-laravel/app/Modules/Auth/Services/AuthService.php:209-212`
- `modular-springboot/src/main/java/com/example/backend/auth/AuthService.java:137`

Setiap refresh mendorong `refresh_families.expires_at` ke `now + 30 hari`. Tidak ada batas umur absolut.

**Skenario gagal:** refresh token yang dicuri (misalnya dari localStorage) tetap bisa dipakai selamanya selama pencurinya melakukan refresh minimal sebulan sekali, walaupun pemilik akun tidak pernah login lagi.

**Perbaikan:** jangan memperpanjang family. Simpan umur absolut saat login (misalnya 90 hari, seperti di .NET), lalu token baru diberi `min(now + 30 hari, family.expires_at)`. Contoh FastAPI:
```python
token_expiry = min(instant + timedelta(days=30), family.expires_at)  # family.expires_at tidak diubah
```

### [MEDIUM] 6. Spring Boot: error database ditelan tanpa log
**Lokasi:** `modular-springboot/src/main/java/com/example/backend/platform/http/ErrorAdvice.java:36-39`

`DataAccessException` dikembalikan sebagai 503 tanpa log apa pun, tidak juga tipe errornya. Ini melanggar aturan "Never swallow errors" di `~/.claude/CLAUDE.md`.

**Skenario gagal:** query yang salah atau koneksi pool habis → klien menerima 503, tetapi operator tidak punya jejak apa pun untuk didiagnosis.

**Perbaikan:**
```java
@ExceptionHandler(DataAccessException.class)
ResponseEntity<Api.Failure> unavailable(DataAccessException e) {
  log.error("database_failure", e);
  return ResponseEntity.status(503).body(Api.Failure.of("Service unavailable"));
}
```

### [MEDIUM] 7. Error 500 hanya mencatat tipe exception (Spring, Laravel, NestJS)
**Lokasi:**
- `modular-springboot/.../platform/http/ErrorAdvice.java:100`
- `modular-laravel/bootstrap/app.php:43`
- `nestjs/src/common/http/http-exception.filter.ts:85`

Log hanya berisi nama kelas, misalnya `NullPointerException`, tanpa pesan atau stack trace. Untuk NestJS ini **regresi**: perbaikan sebelumnya mencatat stack trace, tetapi versi sekarang hanya mencatat `errorType`. .NET sudah diperbaiki untuk masalah yang sama (`LogError(ex, ...)`).

**Skenario gagal:** bug di production cuma meninggalkan jejak "NullPointerException" dengan request ID, tanpa baris kode mana pun yang bisa dilacak.

**Perbaikan:** catat exception lengkap di log server. Log tidak dikirim ke klien; kalau khawatir data sensitif ikut tercatat, redaksi di level sink/log, bukan dengan membuang stack trace.
- Spring: `log.error("request_failure", e)`
- Laravel: `'exception' => $error` di context `Log::error`
- NestJS: `this.logger.error("Request failed", exception instanceof Error ? exception.stack : String(exception))`

### [LOW] 8. Laravel: dummy hash bcrypt di-hardcode dengan cost 12
**Lokasi:** `modular-laravel/app/Modules/Auth/Services/AuthService.php:137`

Hash dummy untuk email yang tidak dikenal di-hardcode dengan cost 12. Kalau `BCRYPT_ROUNDS` atau driver hashing diubah per proyek, waktu respons untuk email tidak dikenal kembali berbeda dan membocorkan keberadaan akun. Kalau driver diganti ke argon, `Hash::check` dengan opsi `verify` terhadap hash `$2y$` akan melempar exception dan menghasilkan 500.

**Perbaikan:** buat hash dummy sekali saat runtime dengan hasher yang aktif:
```php
private static ?string $dummy = null;
// ...
self::$dummy ??= Hash::make(bin2hex(random_bytes(16)));
```

### [LOW] 9. FastAPI, Laravel, Spring: refresh token kedaluwarsa tidak pernah dihapus
**Lokasi:** `modular-fastapi/src/app/modules/auth/service.py:59`, `modular-laravel/.../AuthService.php:130`, `modular-springboot/.../AuthService.java:88`

Express, NestJS, Go dan .NET menghapus refresh token kedaluwarsa milik user saat login. Tiga template baru belum, sehingga tabel `refresh_tokens` dan `refresh_families` terus membesar.

**Perbaikan:** saat login, di dalam transaksi yang sama, hapus family milik user itu yang `expires_at < now`.

## Saran enhancement (di luar bug)

1. **Test paritas antar-template.** Tujuh template dengan aturan keamanan yang sama terbukti mudah berbeda satu sama lain (temuan #1, #2, #5, #7, #9). Buat satu suite HTTP black-box, misalnya dari `contracts/*.json`, yang dijalankan di CI setiap template. Minimal mencakup: anti-eskalasi termasuk admin + permission baru, password > 72 byte → 4xx, email beda huruf kapital → 409, umur refresh absolut, duplikat → 409, dan JSON rusak → 400.
2. **Konstanta root role yang konsisten.** Nama root role sekarang `admin` di sebagian template dan `ADMIN` di Spring. Dokumentasikan satu nama di README CLI, dan pertimbangkan flag `is_root` di tabel `roles` daripada membandingkan nama.
3. **Mode cookie httpOnly untuk refresh token** (opt-in), supaya refresh token tidak perlu disimpan di localStorage. Ini yang membuat temuan #5 lebih berbahaya.
4. **Email lewat antrean.** Laravel sudah punya `email_jobs`. Template lain masih mengirim SMTP di dalam request; kalau notifikasi email jadi fitur klien, gunakan pola antrean yang sama.

## Rekomendasi urutan perbaikan

1. Temuan #1 dan #2: alur admin yang rusak. Perbaikannya kecil.
2. Temuan #3 dan #4: input yang bisa memicu 500 atau akun ganda.
3. Temuan #5: keamanan sesi, dengan perubahan yang sama di tiga template.
4. Temuan #6 dan #7: observability.
5. Temuan #8 dan #9, lalu enhancement nomor 1.
