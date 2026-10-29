# Penghitung Interaksi Media Sosial — Lomba Video HKN 62

Web untuk menghitung views, likes, comments, dan shares dari link video publik TikTok, Instagram, dan Facebook, lalu menghitung Skor Interaksi dan estimasi Nilai Interaksi (maks 30) per instansi untuk Lomba Video Edukasi Kesehatan HKN ke-62.

## Struktur

- `index.html` — halaman utama (satu file, tanpa framework). Daftar link dan hasil terakhir disimpan di localStorage browser. Mendukung auto-refresh 30 menit / 1 jam selama halaman terbuka, dan ekspor CSV.
- `api/stats.js` — Vercel Serverless Function. Menerima `GET /api/stats?url=<link>`, mengambil HTML publik dari server, dan membaca angka dari struktur webnya:
  - TikTok: JSON tertanam `__UNIVERSAL_DATA_FOR_REHYDRATION__` → `itemStruct.stats` (playCount, diggCount, commentCount, shareCount).
  - Facebook: meta `og:title`/`og:image:alt` pada bentuk `/watch/?v=<id>` (mis. "18 reactions · 11 shares").
  - Instagram: metadata/JSON embed bila tersedia; bila tidak, hasilnya kosong dengan status gagal — angka tidak dikarang.

Angka yang tidak ditemukan dikembalikan sebagai `null` dan ditampilkan sebagai "—", bukan 0.

## Rumus

Skor Interaksi = Views + (2 × Likes) + (5 × Comments) + (10 × Shares), dari angka yang tersedia.
Estimasi Nilai (maks 30) bersifat proporsional terhadap Skor Interaksi tertinggi.

## Deploy

Deploy repo ini ke Vercel dengan Framework Preset **Other**, tanpa build command. Tidak perlu `package.json` atau `vercel.json`.

Kode dibuat oleh Claude atas permintaan panitia, berdasarkan uji nyata pembacaan struktur web publik (Oktober 2026).
