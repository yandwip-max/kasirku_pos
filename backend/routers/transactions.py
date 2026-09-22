import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from lib.db import db
from models.transaction import CheckoutIn, Transaction, TransactionItemOut

router = APIRouter(prefix="/transactions")
WIB = ZoneInfo("Asia/Jakarta")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.get("", response_model=List[Transaction])
async def list_transactions(period: str = "30d", method: str = "", q: str = ""):
    query: dict = {}
    now = datetime.now(timezone.utc)
    if period == "today":
        start_wib = now.astimezone(WIB).replace(hour=0, minute=0, second=0, microsecond=0)
        query["created_at"] = {"$gte": start_wib.astimezone(timezone.utc)}
    elif period == "7d":
        query["created_at"] = {"$gte": now - timedelta(days=7)}
    elif period == "30d":
        query["created_at"] = {"$gte": now - timedelta(days=30)}
    if method in ("tunai", "qris"):
        query["payment_method"] = method
    if q.strip():
        escaped = re.escape(q.strip())
        query["$or"] = [
            {"transaction_number": {"$regex": escaped, "$options": "i"}},
            {"customer_name": {"$regex": escaped, "$options": "i"}},
            {"items.imei": {"$regex": escaped, "$options": "i"}},
            {"items.product_name": {"$regex": escaped, "$options": "i"}},
        ]
    docs = await db.transactions.find(query).sort("created_at", -1).to_list(200)
    out = []
    for doc in docs:
        doc["created_at"] = _aware(doc["created_at"])
        out.append(Transaction(**doc))
    return out


@router.post("", response_model=Transaction, status_code=201)
async def create_transaction(input: CheckoutIn):
    if not input.items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")

    now = datetime.now(timezone.utc)
    wib_now = now.astimezone(WIB)
    start_wib = wib_now.replace(hour=0, minute=0, second=0, microsecond=0)
    seq = await db.transactions.count_documents(
        {"created_at": {"$gte": start_wib.astimezone(timezone.utc)}}
    ) + 1
    trx_number = f"TRX-{wib_now.strftime('%Y%m%d')}-{seq:04d}"
    trx_id = str(uuid.uuid4())

    # Pass 1 — fetch and validate everything before mutating any stock.
    products_by_id: dict = {}
    units_by_id: dict = {}
    for item in input.items:
        if item.product_id not in products_by_id:
            products_by_id[item.product_id] = await db.products.find_one({"id": item.product_id})
        if item.unit_id and item.unit_id not in units_by_id:
            units_by_id[item.unit_id] = await db.product_units.find_one(
                {"id": item.unit_id, "product_id": item.product_id}
            )

    for item in input.items:
        product = products_by_id[item.product_id]
        if not product:
            raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
        if product["type"] == "handphone":
            if not item.unit_id:
                raise HTTPException(status_code=400, detail=f"Unit IMEI wajib dipilih untuk {product['name']}")
            unit = units_by_id.get(item.unit_id)
            if not unit:
                raise HTTPException(status_code=404, detail=f"IMEI tidak ditemukan untuk {product['name']}")
            if unit["status"] != "in_stock":
                raise HTTPException(status_code=409, detail=f"IMEI {unit['imei']} sudah terjual")
        else:
            if item.qty < 1:
                raise HTTPException(status_code=400, detail="Jumlah minimal 1")
            if product.get("stock_qty", 0) < item.qty:
                raise HTTPException(status_code=409, detail=f"Stok {product['name']} tidak mencukupi")

    # Pass 2 — atomic claims; roll back everything if any claim fails mid-flight.
    out_items: list[TransactionItemOut] = []
    claimed_units: list[str] = []
    decremented: list[tuple[str, int]] = []
    try:
        for item in input.items:
            product = products_by_id[item.product_id]
            if product["type"] == "handphone":
                unit = units_by_id[item.unit_id]
                claimed = await db.product_units.update_one(
                    {"id": unit["id"], "status": "in_stock"},
                    {"$set": {"status": "sold", "sold_at": now, "transaction_id": trx_id}},
                )
                if claimed.matched_count == 0:
                    raise HTTPException(status_code=409, detail=f"IMEI {unit['imei']} sudah terjual")
                claimed_units.append(unit["id"])
                # a unit may carry its own IMEI-specific selling price; fall back to the product price
                unit_price = int(unit.get("sell_price") or 0) or product["sell_price"]
                out_items.append(
                    TransactionItemOut(
                        product_id=product["id"],
                        product_name=product["name"],
                        unit_id=unit["id"],
                        imei=unit["imei"],
                        color=unit.get("color", ""),
                        capacity=unit.get("capacity", ""),
                        qty=1,
                        price=unit_price,
                        subtotal=unit_price,
                    )
                )
            else:
                updated = await db.products.update_one(
                    {"id": product["id"], "stock_qty": {"$gte": item.qty}},
                    {"$inc": {"stock_qty": -item.qty}},
                )
                if updated.matched_count == 0:
                    raise HTTPException(status_code=409, detail=f"Stok {product['name']} tidak mencukupi")
                decremented.append((product["id"], item.qty))
                out_items.append(
                    TransactionItemOut(
                        product_id=product["id"],
                        product_name=product["name"],
                        qty=item.qty,
                        price=product["sell_price"],
                        subtotal=product["sell_price"] * item.qty,
                    )
                )
    except HTTPException:
        for unit_id in claimed_units:
            await db.product_units.update_one(
                {"id": unit_id},
                {"$set": {"status": "in_stock", "sold_at": None, "transaction_id": None}},
            )
        for product_id, qty in decremented:
            await db.products.update_one({"id": product_id}, {"$inc": {"stock_qty": qty}})
        raise

    total = sum(i.subtotal for i in out_items)
    if input.payment_method == "tunai":
        paid = input.amount_paid or 0
        if paid < total:
            raise HTTPException(status_code=400, detail="Jumlah uang tunai kurang dari total")
    else:
        paid = total

    trx = Transaction(
        id=trx_id,
        transaction_number=trx_number,
        items=out_items,
        total=total,
        payment_method=input.payment_method,
        amount_paid=paid,
        change_amount=paid - total,
        customer_name=input.customer_name.strip(),
        customer_phone=input.customer_phone.strip(),
        cashier_name=input.cashier_name.strip() or "Kasir",
        created_at=now,
    )
    await db.transactions.insert_one(trx.model_dump())
    return trx