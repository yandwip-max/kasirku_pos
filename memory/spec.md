# KasirKu POS — Spesifikasi Aplikasi

## Ringkasan
Aplikasi kasir (POS) untuk toko handphone & aksesoris. UI Bahasa Indonesia, tema terang & bersih (aksen #0284C7, Manrope/IBM Plex Sans/JetBrains Mono). **Tidak ada login/auth** — mode kasir tunggal ("Kasir Pagi").

## Data Model (Mongo, db `app`)
- `products`: `id` (uuid string), `name`, `brand`, `type` ("handphone" | "aksesoris"), `category`, `sku`, `cost_price`, `sell_price` (int rupiah), `stock_qty` (aksesoris saja), `min_stock`, `is_active`, `created_at`
- `product_units`: unit fisik handphone — `id`, `product_id`, `imei` (**unique**, 15 digit), `color`, `capacity`, `status` ("in_stock" | "sold"), `sold_at`, `transaction_id`
- `transactions`: `id`, `transaction_number` (TRX-YYYYMMDD-NNNN, WIB), `items`[{product_id, product_name, unit_id?, imei?, color?, capacity?, qty, price, subtotal}], `total`, `payment_method` ("tunai"|"qris"), `amount_paid`, `change_amount`, `customer_name/phone`, `cashier_name`, `created_at` (aware UTC)

## API (semua di bawah /api)
- `GET /products?search=&type=&low_stock=` → ProductWithStock; `stock` = jumlah unit in_stock (handphone) atau stock_qty (aksesoris); `search` cocokkan name/sku/brand/IMEI unit
- `POST /products`, `PATCH /products/{id}` (type immutable), `DELETE /products/{id}` (hapus unit ikutannya)
- `GET /products/{id}/units?status=`, `POST /products/{id}/units` (IMEI unik → 409 jika duplikat), `DELETE /products/{id}/units/{unit_id}` (hanya in_stock)
- `GET /transactions?period=today|7d|30d|all&method=tunai|qris&q=` (q: no. struk/pembeli/IMEI/nama produk)
- `POST /transactions` — validasi stok 2-tahap + claim atomik + kompensasi rollback; handphone wajib `unit_id` (409 jika IMEI sudah terjual); aksesoris cek `stock_qty >= qty` (409); tunai wajib `amount_paid >= total` (400); QRIS dibayar pas
- `GET /reports/summary?days=7|30|90` — KPI (omset, jumlah trx, unit HP terjual, rata-rata), tren harian diisi nol (zona **Asia/Jakarta**), breakdown metode, top 5 produk

## Halaman (frontend/src/pages)
- `/` — Kasir POS: katalog + search/pill filter (Semua/Handphone/Aksesoris), dialog pilih unit IMEI utk handphone, keranjang (stepper utk aksesoris), dialog pembayaran tab Tunai (quick cash + kembalian, Enter utk konfirmasi) / QRIS (pola QR dekoratif + tombol "Simulasi QRIS Berhasil"), struk + tombol Cetak (window.print + @media print pada `#receipt-print-area`)
- `/products` — CRUD produk; handphone → "Kelola Unit" (tambah/hapus unit IMEI/warna/kapasitas); filter tipe + checkbox stok menipis
- `/transactions` — tabel riwayat + filter periode/metode + search; detail → cetak ulang struk
- `/reports` — 4 KPI, BarChart omset harian, donut metode pembayaran, tabel top 5 (recharts)

## Seed
`backend/seed.py` (idempoten, cek koleksi products kosong): 4 handphone (iPhone 15 Pro, Galaxy S24, Redmi Note 13, Oppo Reno 11 F — tiap unit IMEI/warna/kapasitas unik), 9 aksesoris, 27 transaksi dalam 12 hari terakhir.

## Catatan
- QRIS = **simulasi visual**, bukan integrasi pembayaran asli.
- Jam server UTC; agregasi harian & "Hari Ini" memakai Asia/Jakarta (WIB).
- Setelah IMEI terjual, unit tidak bisa dihapus (409) — jejak transaksi konsisten.
