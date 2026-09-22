# KasirKu POS — Spesifikasi Aplikasi

## Ringkasan
Aplikasi kasir (POS) multi-toko untuk toko handphone & aksesoris. UI Bahasa Indonesia, tema terang & bersih (aksen #0284C7, Manrope/IBM Plex Sans/JetBrains Mono). Terinstal sebagai **PWA** (Android & iOS) dan bisa bertransaksi **offline**.

## Autentikasi & Multi-Toko (tenancy)
- Login **email + password** (JWT HS256, TTL 30 hari, `JWT_SECRET` di backend/.env). Token disimpan di `localStorage` (`kasirku.token`), dikirim sebagai `Authorization: Bearer`.
- **Satu user milik tepat satu toko** (`store_id` di dokumen user) → email unik global. Registrasi membuat toko baru + akun **pemilik** pertama (role di-assign server, bukan dari body).
- Dua peran tenant: **pemilik** (akses penuh) dan **kasir** (transaksi + riwayat saja). Tidak ada peran platform/super-admin.
- Principal di-*derive* ulang dari Mongo setiap request (`lib/auth.py:get_principal`) → perubahan peran / akun dinonaktifkan langsung berlaku.
- Izin (deny-by-default, `PERMISSIONS`):
  - `pemilik`: product:read/write, transaction:create/read, report:read, user:manage, cost:read
  - `kasir`: product:read, transaction:create, transaction:read
- **Isolasi data**: semua query data toko lewat `lib/scoped.py:ScopedRepo` yang WAJIB menyuntik `store_id` (termasuk stage-0 `$match` pada aggregate). Route tidak pernah memanggil `db.<coll>` langsung untuk data tenant. `store_id` di body request diabaikan (di-stamp dari principal).
- Kode status: peran tidak berizin → **403**; data milik toko lain → **404** (tidak membocorkan keberadaan data).
- **Field-level masking**: `cost_price` (produk & unit), `cost` (item transaksi), dan `profit` dikirim `null` untuk Kasir (`mask_cost`), bukan disembunyikan di UI.

## Data Model (Mongo, db `app`)
- `stores`: `id`, `name`, `address`, `phone`, `created_at`
- `users`: `id`, `store_id`, `name`, `email` (unik global), `password_hash` (bcrypt), `role`, `is_active`, `created_at`
- `products`: `id`, `store_id`, `name`, `brand`, `type` ("handphone"|"aksesoris"), `category`, `sku`, `cost_price`, `sell_price`, `stock_qty` (aksesoris), `min_stock`, `is_active`, `created_at`
- `product_units`: unit fisik handphone — `id`, `store_id`, `product_id`, `imei` (**unik per toko**), `color`, `capacity`, `cost_price`, `sell_price` (0 = ikut harga produk), `status` ("in_stock"|"sold"), `sold_at`, `transaction_id`
- `transactions`: `id`, `store_id`, `transaction_number` (TRX-YYYYMMDD-NNNN per toko, WIB), `items`[{product_id, product_name, unit_id?, imei?, color?, capacity?, qty, price, **cost**, subtotal}], `total`, **`profit`**, `payment_method`, `amount_paid`, `change_amount`, `customer_name/phone`, `cashier_name` (dari principal), **`client_ref`** (dedupe offline), `created_at`
- Index kunci: `{store_id, imei}` unik, `{store_id, transaction_number}` unik, `{store_id, client_ref}` unik **partial** (`$type: string`), `{store_id, created_at}`. `ensure_indexes()` juga men-drop index single-tenant lama.

## API (semua di bawah /api)
Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /auth/users` (pemilik), `POST /auth/users` (pemilik), `PATCH /auth/users/{id}/deactivate` (pemilik, tidak bisa akun sendiri → 409)
Produk: `GET /products?search=&type=&low_stock=`, `POST /products`, `PATCH /products/{id}`, `DELETE /products/{id}`, `GET|POST /products/{id}/units`, `DELETE /products/{id}/units/{unit_id}`
Transaksi: `GET /transactions?period=today|7d|30d|all&method=&q=`, `POST /transactions`
- validasi 2-tahap + claim atomik + rollback kompensasi; harga & **harga modal di-snapshot** per item
- `client_ref` sudah ada → kembalikan transaksi yang sama (replay offline idempoten); `offline_created_at` menjaga waktu asli penjualan
Laporan (pemilik): `GET /reports/summary?days=`, **`GET /reports/daily?days=7|14|30`** → baris per hari: `revenue`, `profit`, `transactions`, `items_sold`, `phones_sold`, `cash`, `qris`, `margin_percent` + total & `best_day`. Laba = Σ(subtotal − cost × qty) dari snapshot, jadi edit harga tidak mengubah laporan lampau.

## Halaman (frontend/src/pages)
- `/login` — tab Masuk / Daftar Toko Baru + tombol isi-otomatis akun demo
- `/` — Kasir POS (semua peran): katalog, filter, pilih unit IMEI, keranjang, bayar Tunai/QRIS, struk + cetak. **Offline**: transaksi masuk antrean IndexedDB, struk lokal bertanda "OFFLINE"
- `/products` — pemilik: CRUD produk + Kelola Unit (IMEI/warna/kapasitas + harga modal & jual per unit)
- `/transactions` — riwayat + filter + cetak ulang struk (Kasir tidak melihat laba)
- `/reports/daily` — **Laporan Penjualan Harian**: KPI (penjualan, keuntungan, transaksi, hari terbaik), grafik batang penjualan + garis keuntungan, tabel rincian per hari
- `/reports` — ringkasan: 5 KPI (termasuk Total Keuntungan), tren omset, donut metode bayar, top 5 produk
- `/users` — pemilik: tambah pengguna (Pemilik/Kasir), aktif/nonaktifkan akun

## PWA & Offline
- `public/manifest.webmanifest` (standalone, theme #0284C7, ikon 192/512/maskable-512, shortcut Kasir & Laporan Harian) + meta apple-touch-icon → installable di Android & iOS.
- `public/sw.js` (`kasirku-v3`): shell precache + navigasi network-first fallback cache (boot offline), aset cache-first, `GET /api/*` network-first dengan cache fallback; un-cached saat offline → **503** yang dipetakan ke `OfflineError` di `lib/api.ts`. Request tulis tidak pernah di-cache.
- Antrean offline: `lib/offlineQueue.ts` (IndexedDB `kasirku-offline/pending_sales`, key `client_ref`) + `hooks/useOfflineSync.ts` — flush otomatis saat event `online`/mount, invalidasi query TanStack setelah sukses, transaksi yang ditolak server (mis. IMEI sudah terjual) ditandai `error` dan bisa dihapus manual. Mutasi antrean menyiarkan event `kasirku:queue-changed` agar badge header langsung ter-update.
- Sesi di-cache (`kasirku.session`) agar aplikasi tetap terbuka offline; `GET /auth/me` yang gagal karena offline tidak memaksa logout.

## Seed
`backend/seed.py` (idempoten, cek nama toko demo) membuat **satu toko demo** + 2 akun, 4 handphone (unit IMEI per warna/kapasitas), 9 aksesoris, ~23 transaksi 12 hari terakhir dengan `cost` & `profit`. Toko yang mendaftar baru selalu mulai kosong.

## Catatan
- QRIS = **simulasi visual**, bukan integrasi pembayaran asli.
- Jam server UTC; semua agregasi harian & "Hari Ini" memakai Asia/Jakarta (WIB).
- Unit yang sudah terjual tidak bisa dihapus (409) agar jejak transaksi konsisten.
