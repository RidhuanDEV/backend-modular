# Contract parity

Starter Express, .NET, dan Go berbagi baseline kontrak HTTP agar pengguna dapat memilih stack dengan endpoint dan envelope yang familier. Pada repository Go, server test membandingkan endpoint baseline dengan snapshot Express di `contracts/express-endpoints.json` dan response baseline dengan snapshot Zod di `contracts/express-schemas.json`. Penambahan yang khusus untuk Go dicatat terpisah di `contracts/go-endpoint-extensions.json` dan `contracts/go-auth-schemas.json`.

Pemeriksaan mencakup method, path, operation ID, modul, akses publik, permission, audit/rate/cache policy, status, bentuk response, tipe, dan nullability. Token, UUID, dan timestamp acak dibandingkan berdasarkan bentuk, bukan nilainya. Validasi regex Zod JavaScript tidak dijalankan sebagai regex Go; aturan input Go perlu test-nya sendiri.

Keamanan tetap mengikuti perilaku Go yang eksplisit: input JSON yang tidak dikenal ditolak, password dibatasi 72 byte untuk bcrypt, dan kegagalan PostgreSQL tidak disamarkan sebagai kredensial salah. Karena itu parity tidak berarti menyamakan keputusan keamanan yang berbeda.

## Saat kontrak keluarga berubah

1. Sepakati perubahan API pada stack sumber/anggota keluarga yang relevan.
2. Perbarui registry dan DTO runtime setiap template yang memang mengikuti kontrak itu.
3. Regenerasi atau review fixture response dan endpoint dari source of truth; jangan ubah snapshot hanya untuk membuat CI hijau.
4. Jalankan contract/parity tests pada repository yang berubah dan dokumentasikan perbedaan keamanan atau perilaku.

Endpoint baseline Go harus cocok dengan Express. `POST /api/auth/refresh` adalah ekstensi khusus Go yang tercatat eksplisit di fixture lokal dan tidak mengubah snapshot Express. Penambahan atau penghapusan endpoint baseline di satu repo akan menggagalkan `TestExpressEndpointParity` sampai kontrak direview. Auth response Go memakai DTO publik dan token pair sendiri; bentuk tersebut diuji terhadap fixture lokal, sementara endpoint lain memakai snapshot Express. Untuk aplikasi turunan yang sengaja membangun API independen, hapus atau ubah parity test dan fixture yang sesuai. Pertahankan test registry/OpenAPI runtime agar dokumentasi dan endpoint tetap terverifikasi.
