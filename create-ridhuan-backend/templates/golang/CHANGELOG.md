# Changelog

Perubahan penting template dicatat di sini. Rilis mengikuti Semantic Versioning setelah tag rilis publik tersedia.

## Unreleased

- Susun ulang onboarding README, tambah quick start dan contoh register/login.
- Tambah panduan modul, contract parity, dan testing untuk pengguna template.
- Tambah Subresource Integrity pada Redoc 2.5.4 yang dipin.
- Keamanan: manager tidak bisa memberi, mengubah, atau menghapus role/user dengan permission yang tidak ia miliki (role seed `admin` dikecualikan); login email tak dikenal memakai dummy hash agar waktu respons tidak membocorkan akun; refresh token kedaluwarsa dihapus saat login; seed menolak password placeholder di production.
- Keamanan (audit): permission dan role sistem (`manage_*`, `admin`, `user`) tidak bisa diganti nama/dihapus/dibuat ulang; akses admin murni RBAC (tanpa pengecualian nama role): permission baru otomatis diberikan ke setiap role yang memegang `manage_permissions`, dan tidak ada perubahan yang boleh membuat permission sistem tanpa pemegang aktif; sesi refresh dicabut saat user dihapus atau role berubah; sesi refresh absolut 90 hari (idle 30 hari); file upload hanya bisa dibaca pemilik atau admin; rate limit dijalankan sebelum query DB; limiter memory dibatasi; redaksi audit berbasis substring; validasi module path initializer; nama file upload disanitasi; `JWT_SECRET` placeholder ditolak di production; header keamanan tambahan; `/docs` mati di production kecuali `DOCS_ENABLED=true`.
