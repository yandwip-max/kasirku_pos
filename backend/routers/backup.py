"""Data backup: a full JSON snapshot of the shop, or CSV exports for Excel.

Owner-only and always store-scoped — a backup must never leak another tenant's rows.
"""

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.auth import Principal, require
from lib.dates import today_iso
from lib.scoped import ScopedRepo, scoped_repo

router = APIRouter(prefix="/backup")

COLLECTIONS = ("products", "product_units", "transactions", "activity_logs")
DATASETS = {
    "products": ["id", "name", "type", "category", "brand", "sku", "cost_price", "sell_price", "wholesale_price", "stock_qty", "min_stock"],
    "units": ["id", "product_id", "imei", "color", "capacity", "status", "cost_price", "sell_price"],
    "transactions": ["transaction_number", "created_at", "status", "cashier_name", "customer_name", "payment_method", "gross_total", "discount_total", "total", "profit", "items"],
}


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


@router.get("/csv/{dataset}")
async def export_csv(
    dataset: str,
    principal: Principal = Depends(require("user:manage")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Excel-friendly export. `items` on a transaction is flattened to one text cell."""
    if dataset not in DATASETS:
        raise HTTPException(status_code=404, detail="Jenis data tidak dikenal")

    collection = {"products": "products", "units": "product_units", "transactions": "transactions"}[dataset]
    docs = await repo.find(collection, {}).to_list(100000)
    columns = DATASETS[dataset]

    buffer = io.StringIO()
    buffer.write("\ufeff")  # BOM so Excel reads the Indonesian text correctly
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(columns)
    for doc in docs:
        row = []
        for column in columns:
            value = doc.get(column)
            if column == "items" and isinstance(value, list):
                value = " | ".join(
                    f"{i.get('product_name')} x{i.get('qty')} @{i.get('price')}"
                    + (f" IMEI {i['imei']}" if i.get("imei") else "")
                    for i in value
                )
            elif isinstance(value, datetime):
                value = (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
            elif column == "status" and not value:
                value = "selesai"
            row.append("" if value is None else value)
        writer.writerow(row)

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(dataset, "csv")}"'},
    )
