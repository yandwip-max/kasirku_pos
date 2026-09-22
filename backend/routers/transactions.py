import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, mask_cost, require
from lib.scoped import ScopedRepo, scoped_repo
from models.transaction import CartItemIn, CheckoutIn, Transaction, TransactionItemOut

router = APIRouter(prefix="/transactions")
WIB = ZoneInfo("Asia/Jakarta")

# Stock for these types is a plain quantity; handphones are tracked per IMEI unit.
QTY_TYPES = ("aksesoris", "voucher")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _trx_out(doc: dict, principal: Principal) -> Transaction:
    """Kasir never sees cost/profit figures — masked here, not in the UI."""
    items = [
        TransactionItemOut(**{**item, "cost": mask_cost(principal, item.get("cost", 0))}) for item in doc["items"]
    ]
    gross = doc.get("gross_total") or sum(i.qty * i.price for i in items)
    return Transaction(
        **{
            **doc,
            "items": [i.model_dump() for i in items],
            "gross_total": gross,
            "discount_total": doc.get("discount_total", 0),
            "created_at": _aware(doc["created_at"]),
            "profit": mask_cost(principal, doc.get("profit", 0)),
        }
    )


def _tier_price(product: dict, tier: str) -> int:
    """Voucher lines may be sold at the wholesale tier; everything else is retail."""
    if product["type"] == "voucher" and tier == "grosir":
        return int(product.get("wholesale_price") or 0) or product["sell_price"]
    return product["sell_price"]


def _resolve_discount(item: CartItemIn, gross: int, product_name: str) -> int:
    """Turn the requested discount into rupiah. Never trust a client-sent amount."""
    if not item.discount_type or item.discount_value <= 0:
        return 0
    if item.discount_value < 0:
        raise HTTPException(status_code=400, detail="Diskon tidak boleh negatif")
    if item.discount_type == "persen":
        if item.discount_value > 100:
            raise HTTPException(status_code=400, detail="Diskon persen maksimal 100%")
        return gross * item.discount_value // 100
    if item.discount_value > gross:
        raise HTTPException(
            status_code=400, detail=f"Diskon {product_name} melebihi harga item"
        )
    return item.discount_value


@router.get("", response_model=List[Transaction])
async def list_transactions(
    period: str = "30d",
    method: str = "",
    q: str = "",
    principal: Principal = Depends(require("transaction:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
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
    docs = await repo.find("transactions", query).sort("created_at", -1).to_list(200)
    return [_trx_out(doc, principal) for doc in docs]


@router.post("", response_model=Transaction, status_code=201)
async def create_transaction(
    input: CheckoutIn,
    principal: Principal = Depends(require("transaction:create")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    if not input.items:
        raise HTTPException(status_code=400, detail="Keranjang kosong")

    # Offline replay: the same queued sale must not be recorded twice.
    if input.client_ref:
        existing = await repo.find_one("transactions", {"client_ref": input.client_ref})
        if existing:
            return _trx_out(existing, principal)

    now = datetime.now(timezone.utc)
    wib_now = now.astimezone(WIB)
    start_wib = wib_now.replace(hour=0, minute=0, second=0, microsecond=0)
    seq = await repo.count_documents(
        "transactions", {"created_at": {"$gte": start_wib.astimezone(timezone.utc)}}
    ) + 1
    trx_number = f"TRX-{wib_now.strftime('%Y%m%d')}-{seq:04d}"
    trx_id = str(uuid.uuid4())

    # Pass 1 — fetch and validate everything before mutating any stock.
    products_by_id: dict = {}
    units_by_id: dict = {}
    for item in input.items:
        if item.product_id not in products_by_id:
            products_by_id[item.product_id] = await repo.find_one("products", {"id": item.product_id})
        if item.unit_id and item.unit_id not in units_by_id:
            units_by_id[item.unit_id] = await repo.find_one(
                "product_units", {"id": item.unit_id, "product_id": item.product_id}
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

    # Pass 2 — price every line and settle the payment BEFORE touching stock. A rejected
    # payment must never leave stock decremented or an IMEI flagged sold.
    planned: list[tuple[dict, Optional[dict], TransactionItemOut]] = []
    for item in input.items:
        product = products_by_id[item.product_id]
        if product["type"] == "handphone":
            unit = units_by_id[item.unit_id]
            # a unit may carry its own IMEI-specific price; fall back to the product price
            price = int(unit.get("sell_price") or 0) or product["sell_price"]
            cost = int(unit.get("cost_price") or 0) or product.get("cost_price", 0)
            qty, tier = 1, "ritel"
        else:
            unit = None
            tier = item.price_tier if product["type"] == "voucher" else "ritel"
            price = _tier_price(product, tier)
            cost = product.get("cost_price", 0)
            qty = item.qty

        gross = price * qty
        discount = _resolve_discount(item, gross, product["name"])
        planned.append(
            (
                product,
                unit,
                TransactionItemOut(
                    product_id=product["id"],
                    product_name=product["name"],
                    unit_id=unit["id"] if unit else None,
                    imei=unit["imei"] if unit else None,
                    color=unit.get("color", "") if unit else None,
                    capacity=unit.get("capacity", "") if unit else None,
                    qty=qty,
                    price=price,
                    price_tier=tier,
                    cost=cost,  # snapshot: later price edits must not rewrite history
                    discount_type=item.discount_type if discount else None,
                    discount_value=item.discount_value if discount else 0,
                    discount=discount,
                    subtotal=gross - discount,
                ),
            )
        )

    out_items = [line for _, _, line in planned]
    gross_total = sum(i.qty * i.price for i in out_items)
    discount_total = sum(i.discount for i in out_items)
    total = sum(i.subtotal for i in out_items)
    # discounts shrink the margin, so profit follows the discounted subtotal
    profit = sum(i.subtotal - (i.cost or 0) * i.qty for i in out_items)
    if input.payment_method == "tunai":
        paid = input.amount_paid or 0
        if paid < total:
            raise HTTPException(status_code=400, detail="Jumlah uang tunai kurang dari total")
    else:
        paid = total

    # Pass 3 — atomic claims; roll back everything if any claim fails mid-flight.
    claimed_units: list[str] = []
    decremented: list[tuple[str, int]] = []
    try:
        for product, unit, line in planned:
            if unit is not None:
                claimed = await repo.update_one(
                    "product_units",
                    {"id": unit["id"], "status": "in_stock"},
                    {"$set": {"status": "sold", "sold_at": now, "transaction_id": trx_id}},
                )
                if claimed.matched_count == 0:
                    raise HTTPException(status_code=409, detail=f"IMEI {unit['imei']} sudah terjual")
                claimed_units.append(unit["id"])
            else:
                updated = await repo.update_one(
                    "products",
                    {"id": product["id"], "stock_qty": {"$gte": line.qty}},
                    {"$inc": {"stock_qty": -line.qty}},
                )
                if updated.matched_count == 0:
                    raise HTTPException(status_code=409, detail=f"Stok {product['name']} tidak mencukupi")
                decremented.append((product["id"], line.qty))
    except HTTPException:
        for unit_id in claimed_units:
            await repo.update_one(
                "product_units",
                {"id": unit_id},
                {"$set": {"status": "in_stock", "sold_at": None, "transaction_id": None}},
            )
        for product_id, qty in decremented:
            await repo.update_one("products", {"id": product_id}, {"$inc": {"stock_qty": qty}})
        raise

    trx = Transaction(
        id=trx_id,
        store_id=principal.store_id,
        transaction_number=trx_number,
        items=out_items,
        gross_total=gross_total,
        discount_total=discount_total,
        total=total,
        profit=profit,
        payment_method=input.payment_method,
        amount_paid=paid,
        change_amount=paid - total,
        customer_name=input.customer_name.strip(),
        customer_phone=input.customer_phone.strip(),
        cashier_name=principal.name,  # server-derived, never client-supplied
        client_ref=input.client_ref,
        created_at=input.offline_created_at or now,
    )
    await repo.insert_one("transactions", trx.model_dump(exclude={"store_id"}))
    return _trx_out(trx.model_dump(), principal)