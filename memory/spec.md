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

## Diskon per Item & Tipe Produk Voucher
- **Diskon per item** (Kasir & Pemilik, tanpa batas): tiap baris keranjang bisa diberi diskon **nominal (Rp)** atau **persen (%)**. Server selalu menghitung ulang rupiah diskon dari `discount_type` + `discount_value` (`_resolve_discount`) — nilai uang dari klien tidak pernah dipercaya. Validasi: persen > 100 → **400**, nominal > harga item → **400**. UI meng-clamp input persen ke 100 sehingga state invalid tidak terjadi dari layar; tombol bayar dikunci bila tetap invalid.
- Transaksi menyimpan `gross_total` (sebelum diskon), `discount_total`, dan `total`; tiap item menyimpan `price` (sebelum diskon), `discount_type`, `discount_value`, `discount`, `subtotal`. **Laba ikut turun** karena dihitung dari `subtotal − cost × qty`.
- Struk menampilkan potongan per item + Subtotal & Total Diskon; riwayat menampilkan badge diskon per transaksi.
- **Tipe produk `voucher`** (Voucher Pulsa): stok berupa jumlah (seperti aksesoris, bukan IMEI) dengan **dua harga** — `sell_price` (ritel) dan `wholesale_price` (grosir; 0 = ikut ritel). Kasir memilih tier **Ritel/Grosir** per baris keranjang (`price_tier`); tier hanya berlaku untuk voucher, tipe lain selalu ritel. Tier tersimpan di item transaksi dan tampil di struk sebagai "(Grosir)".
- Menambah unit IMEI ke produk voucher/aksesoris → **409**.

## Urutan transaksi (penting)
`POST /transactions` berjalan 3 tahap: (1) ambil & validasi produk/unit/stok, (2) **hitung harga, diskon, dan lunasi pembayaran** — tunai kurang → 400 di sini, (3) baru klaim stok/unit secara atomik dengan rollback kompensasi. Urutan ini wajib: sebelumnya validasi tunai terjadi setelah stok dipotong sehingga checkout gagal tetap menghabiskan stok & menandai IMEI terjual (bug, sudah diperbaiki).

## Input angka (wajib diikuti)
Semua field uang & stok di form (produk, unit IMEI) memakai **input teks digit-only** (`NumberField` di ProductsPage) dengan format ribuan otomatis, lalu dikirim sebagai bilangan bulat via `parseRupiah`. Jangan pakai `<Input type="number">` untuk rupiah: browser membaca pemisah ribuan Indonesia "13.500" sebagai desimal **13,5** sehingga Pydantic menolaknya (`int_from_float` → 422 "data tidak valid") — ini bug yang pernah terjadi pada form Voucher Pulsa. Sebagai lapis kedua, `ProductCreate`/`ProductUpdate`/`ProductUnitCreate` punya `field_validator` yang menerima int, float (dibulatkan), dan string berformat ("13.500" → 13500).

## Data Model (Mongo, db `app`)
- `stores`: `id`, `name`, `address`, `phone`, `created_at`
- `users`: `id`, `store_id`, `name`, `email` (unik global), `password_hash` (bcrypt), `role`, `is_active`, `created_at`
- `products`: `id`, `store_id`, `name`, `brand`, `type` ("handphone"|"aksesoris"|"voucher"), `category`, `sku`, `cost_price`, `sell_price` (ritel), `wholesale_price` (grosir, voucher), `stock_qty` (aksesoris & voucher), `min_stock`, `is_active`, `created_at`
- `product_units`: unit fisik handphone — `id`, `store_id`, `product_id`, `imei` (**unik per toko**), `color`, `capacity`, `cost_price`, `sell_price` (0 = ikut harga produk), `status` ("in_stock"|"sold"), `sold_at`, `transaction_id`
- `transactions`: `id`, `store_id`, `transaction_number` (TRX-YYYYMMDD-NNNN per toko, WIB), `items`[{product_id, product_name, unit_id?, imei?, color?, capacity?, qty, price, **cost**, subtotal}], `total`, **`profit`**, `payment_method`, `amount_paid`, `change_amount`, `customer_name/phone`, `cashier_name` (dari principal), **`client_ref`** (dedupe offline), `created_at`
- Index kunci: `{store_id, imei}` unik, `{store_id, transaction_number}` unik, `{store_id, client_ref}` unik **partial** (`$type: string`), `{store_id, created_at}`. `ensure_indexes()` juga men-drop index single-tenant lama.

## API (semua di bawah /api)
Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /auth/users` (pemilik), `POST /auth/users` (pemilik), `PATCH /auth/users/{id}` (pemilik — ubah nama, min 2 karakter, boleh akun sendiri), `PATCH /auth/users/{id}/deactivate` (pemilik, tidak bisa akun sendiri → 409)
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
- `/users` — pemilik: tambah pengguna (Pemilik/Kasir), **edit nama pengguna** (tombol "Edit Nama" di tiap baris → `PATCH /auth/users/{id}`; email & peran tidak berubah, boleh mengubah nama sendiri dan header ikut ter-update lewat `refreshSession()` dari AuthProvider), aktif/nonaktifkan akun

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

## Pengaturan Toko & Akun (halaman /users, khusus Pemilik)
- **Profil Toko** — kartu `store-profile-card` + dialog edit (`PATCH /api/auth/store`): nama, alamat, no. WhatsApp. Ketiganya tercetak di kepala struk (`ReceiptView.tsx`).
- **Atur Ulang Password** — tombol "Password" per baris pengguna (`PATCH /api/auth/users/{user_id}/password`). Password lama tidak diperlukan; min. 6 karakter, harus sama dengan konfirmasi. Scoped `store_id` (pengguna toko lain → 404).
- **Notifikasi Stok Menipis** — `LowStockAlert` di halaman Kasir (POS) membandingkan `stock_qty` vs `min_stock` untuk aksesoris & voucher.

## Riwayat Aktivitas (audit trail) — halaman /activity, khusus Pemilik
- Koleksi `activity_logs`: {id, store_id, at, actor_id, actor_name, actor_role, action, category, entity_name, summary, changes[{field,before,after}]}.
- Kategori: `harga`, `stok`, `produk`, `akun` (buat/rename/reset password/aktif-nonaktif), `toko`.
- Dicatat di: products (create/update/delete, tambah & hapus unit IMEI) dan auth (create user, rename, reset password, aktif/nonaktif, edit profil toko) lewat `lib/audit.py::log_activity` (gagal menulis log tidak pernah menggagalkan aksi).
- `GET /api/activity?period=today|7d|30d|all&category=&q=&skip=&limit=` (izin `user:manage`; Kasir → 403).

## Cetak Struk — ukuran kertas printer
- Dialog struk punya pemilih **58 mm / 80 mm / A4** (`src/lib/printer.ts`, tersimpan di localStorage `kasirku.paper-size`).
- Pilihan menulis `body[data-paper]` + menyuntik `@page { size: 58mm auto; margin: 0 }`; aturan cetak per ukuran ada di `src/index.css`. 58 mm = printer portable/bluetooth (font & padding lebih rapat, `ReceiptView compact`).

## Cetak ke printer thermal portable / bluetooth
Dialog struk punya 3 jalur cetak (`src/lib/printer.ts`, teks ESC/POS di `src/lib/escpos.ts`):
1. **RawBT (Android)** — `intent:<teks>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`. Jalur utama untuk printer bluetooth 58mm; user perlu pasang app RawBT (link Play Store ada di dialog).
2. **Bluetooth langsung (Web Bluetooth)** — pair lewat `navigator.bluetooth`, cari service serial 0x18F0/0xFF00/0xAE30/0xFFE0, tulis byte ESC/POS per 180 byte. Tombol nonaktif bila browser tak mendukung.
3. **Dialog Cetak** — iframe cetak (printer USB/LAN/A4).
Lebar teks: 32 kolom untuk 58mm, 48 kolom untuk 80mm.

## Catatan kaki struk (bisa diubah Pemilik)
- Field `stores.receipt_warranty` & `stores.receipt_thanks` (default: "Garansi resmi toko 7 hari…" / "Terima kasih telah berbelanja!").
- Diedit di dialog **Edit Profil Toko** (halaman /users). Mengosongkan field = kembali ke teks bawaan. Batas 200 & 120 karakter (lebih dari itu → 422).
- Dipakai di `ReceiptView.tsx` (tampilan + dialog cetak) dan `lib/escpos.ts` (RawBT/Bluetooth), jadi teks kustom ikut tercetak di printer 58mm.

## Void / Retur Transaksi (khusus Pemilik, izin `transaction:void`)
- `POST /api/transactions/{id}/void` body `{void_type: "void"|"retur", reason: >=3 char}`.
- Transaksi TIDAK dihapus: `status="void"` + `void_type/void_reason/voided_by/voided_at`. Stok dikembalikan (unit IMEI → `in_stock`, produk qty `$inc`). Update `status` dilakukan atomik dulu agar double-void → 409.
- Laporan (`/reports/summary`, `/reports/daily`) mengecualikan `status: "void"`; halaman Riwayat menandai baris dengan badge + alasan; aksi tercatat di Riwayat Aktivitas (kategori stok).
- Kasir → 403. Transaksi tak ada → 404. Alasan < 3 karakter → 422.

## Backup Data (khusus Pemilik)
- `GET /api/backup/export` → snapshot JSON (products, product_units, transactions, activity_logs + counts), semua ter-scope `store_id`.
- `GET /api/backup/csv/{products|units|transactions}` → CSV delimiter `;` + BOM UTF-8 (Excel ID). Dataset lain → 404.
- UI: kartu **Backup Data Toko** di halaman /users; unduhan lewat fetch + blob karena butuh header bearer.
- Catatan: daftar izin sisi klien (`PERMISSIONS_BY_ROLE` di `src/lib/auth.tsx`) HARUS ikut diperbarui saat menambah izin baru di `backend/lib/auth.py` — respons login tidak mengirim `permissions` (hanya `/auth/me`), jadi tombol bisa hilang bila lupa.

## Modal / HPP di laporan
- `ReportSummary.total_cogs` dan `DailyRow.cogs` + `DailyReport.total_cogs` (backend/models/report.py) dihitung dari snapshot `item.cost * qty` pada tiap transaksi (mengabaikan transaksi void), jadi `revenue - cogs == profit` selalu konsisten.
- UI: KPI "Modal / HPP" di /reports dan /reports/daily (+ kolom "Modal (HPP)" per hari). Kasir tetap 403 untuk semua laporan.
