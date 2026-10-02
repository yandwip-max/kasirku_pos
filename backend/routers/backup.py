"""Data backup: a full JSON snapshot of the shop, or CSV exports for Excel.

Owner-only and always store-scoped — a backup must never leak another tenant's rows.
"""

import io
import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.auth import Principal, require
from lib.dates import today_iso
from lib.db import db
from lib.scoped import ScopedRepo, scoped_repo
from routers.cron import WIB, _recap_html, _store_recap
from lib.email import send_email

router = APIRouter(prefix="/backup")

COLLECTIONS = ("products", "product_units", "transactions", "activity_logs")

# dataset -> (database collection, {field: Indonesian column header}).
# Internal ids are left out: the export is for reading in Excel, not for re-import.
DATASETS: dict[str, tuple[str, dict[str, str]]] = {
    "products": (
        "products",
        {
            "name": "Nama Produk",
            "type": "Tipe",
            "category": "Folder / Kategori",
            "brand": "Merek",
            "sku": "SKU",
            "cost_price": "Harga Modal",
            "sell_price": "Harga Jual",
            "wholesale_price": "Harga Grosir",
            "stock_qty": "Stok",
            "min_stock": "Stok Minimum",
        },
    ),
    "units": (
        "product_units",
        {
            "product_name": "Nama Produk",
            "imei": "IMEI",
            "color": "Warna",
            "capacity": "Kapasitas",
            "status": "Status",
            "cost_price": "Harga Modal",
            "sell_price": "Harga Jual",
            "created_at": "Tanggal Masuk",
            "sold_at": "Tanggal Terjual",
        },
    ),
    "transactions": (
        "transactions",
        {
            "transaction_number": "No. Struk",
            "created_at": "Tanggal",
            "status": "Status",
            "cashier_name": "Kasir",
            "customer_name": "Pembeli",
            "payment_method": "Pembayaran",
            "gross_total": "Subtotal",
            "discount_total": "Diskon",
            "total": "Total",
            "profit": "Laba",
            "items": "Rincian Barang",
        },
    ),
}

STATUS_LABELS = {"in_stock": "Tersedia", "sold": "Terjual", "selesai": "Selesai", "void": "Dibatalkan"}


def _json_safe(value):
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _filename(kind: str, ext: str) -> str:
    return f"kasirku-{kind}-{today_iso()}.{ext}"


@router.get("/export")
async def export_json(
    principal: Principal = Depends(require("user:manage")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Full snapshot, restorable by hand. Everything filtered to this store."""
    snapshot: dict = {
        "app": "KasirKu",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "store_id": principal.store_id,
        "data": {},
    }
    for name in COLLECTIONS:
        docs = await repo.find(name, {}).to_list(100000)
        snapshot["data"][name] = [_json_safe({k: v for k, v in doc.items() if k != "_id"}) for doc in docs]
    snapshot["counts"] = {name: len(rows) for name, rows in snapshot["data"].items()}

    body = json.dumps(snapshot, ensure_ascii=False, indent=1)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_filename("backup", "json")}"'},
    )


@router.post("/send-report-now")
async def send_report_now(principal: Principal = Depends(require("user:manage"))):
    """Send this owner their own weekly recap right now — a self-test for the email setup.

    The recipient is always the caller's stored email and the body is the same
    server-side template the cron uses; nothing here is caller-supplied.
    """
    user = await db.users.find_one({"id": principal.user_id, "store_id": principal.store_id})
    store = await db.stores.find_one({"id": principal.store_id})
    if not user or not store or not user.get("email"):
        raise HTTPException(status_code=404, detail="Akun atau toko tidak ditemukan")

    # light rate limit: one test email per account every 2 minutes
    last = await db.email_tests.find_one({"user_id": principal.user_id})
    now = datetime.now(timezone.utc)
    if last and (now - last["sent_at"].replace(tzinfo=timezone.utc)) < timedelta(minutes=2):
        raise HTTPException(status_code=429, detail="Tunggu 2 menit sebelum mengirim email uji lagi")

    now_wib = datetime.now(WIB)
    period = f"{(now_wib - timedelta(days=6)).strftime('%d %b')} – {now_wib.strftime('%d %b %Y')}"
    recap = await _store_recap(principal.store_id)
    email_id = await send_email(
        to=user["email"],
        subject=f"[Uji kirim] Laporan mingguan {store.get('name', 'toko Anda')} — {period}",
        html=_recap_html(store.get("name", "Toko"), user.get("name", "Pemilik"), recap, period),
    )
    if not email_id:
        # 400, not 502: the CDN replaces upstream 5xx bodies with its own error page,
        # which would hide this message from the user.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Email gagal dikirim ke {user['email']}. Pastikan alamatnya aktif dan benar "
                "(email contoh seperti @demo.id ditolak penyedia email)."
            ),
        )

    await db.email_tests.update_one(
        {"user_id": principal.user_id}, {"$set": {"sent_at": now, "email": user["email"]}}, upsert=True
    )
    return {"status": "sent", "to": user["email"], "email_id": email_id}


@router.get("/xlsx/{dataset}")
async def export_xlsx(
    dataset: str,
    principal: Principal = Depends(require("user:manage")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Real Excel workbook: proper columns, Indonesian headers, readable labels.

    CSV was fragile — Excel/WPS on Android put every field in one cell unless the
    delimiter happened to match the device locale. A .xlsx file has no delimiter at all.
    """
    if dataset not in DATASETS:
        raise HTTPException(status_code=404, detail="Jenis data tidak dikenal")

    collection, columns = DATASETS[dataset]
    docs = await repo.find(collection, {}).to_list(100000)

    # units carry only product_id; resolve the product name so the sheet is readable
    if dataset == "units":
        products = await repo.find("products", {}).to_list(5000)
        names = {p["id"]: p.get("name", "") for p in products}
        for doc in docs:
            doc["product_name"] = names.get(doc.get("product_id"), "(produk terhapus)")

    rows = []
    for doc in docs:
        row: dict = {}
        for field, header in columns.items():
            value = doc.get(field)
            if field == "items" and isinstance(value, list):
                value = "\n".join(
                    f"{i.get('product_name')} x{i.get('qty')} @{i.get('price')}"
                    + (f" (IMEI {i['imei']})" if i.get("imei") else "")
                    for i in value
                )
            elif isinstance(value, datetime):
                aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
                value = aware.astimezone(WIB).strftime("%d/%m/%Y %H:%M")
            elif field == "status":
                value = STATUS_LABELS.get(value or "selesai", value or "selesai")
            elif field == "type":
                value = {"handphone": "Handphone", "aksesoris": "Aksesoris", "voucher": "Voucher Data"}.get(value, value)
            elif field == "payment_method":
                value = {"tunai": "Tunai", "qris": "QRIS", "piutang": "Piutang"}.get(value, value)
            row[header] = "" if value is None else value
        rows.append(row)

    frame = pd.DataFrame(rows, columns=list(columns.values()))
    buffer = io.BytesIO()
    sheet = {"products": "Produk", "units": "Stok IMEI", "transactions": "Transaksi"}[dataset]
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        frame.to_excel(writer, index=False, sheet_name=sheet, freeze_panes=(1, 0))
        worksheet = writer.sheets[sheet]
        for index, header in enumerate(frame.columns, start=1):
            widest = max([len(str(header))] + [len(str(v)[:40]) for v in frame[header].head(200)] or [0])
            worksheet.column_dimensions[worksheet.cell(row=1, column=index).column_letter].width = min(widest + 3, 42)

    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_filename(dataset, "xlsx")}"'},
    )

