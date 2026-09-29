# Changelog

Perubahan penting template dicatat di sini. Rilis mengikuti Semantic Versioning setelah tag rilis publik tersedia.

## Unreleased

- Susun ulang onboarding README, tambah quick start dan contoh register/login.
- Tambah panduan modul, contract parity, dan testing untuk pengguna template.
- Tambah Subresource Integrity pada Redoc 2.5.4 yang dipin.
- Keamanan: manager tidak bisa memberi, mengubah, atau menghapus role/user dengan permission yang tidak ia miliki (role seed `admin` dikecualikan); login email tak dikenal memakai dummy hash agar waktu respons tidak membocorkan akun; refresh token kedaluwarsa dihapus saat login; seed menolak password placeholder di production.
