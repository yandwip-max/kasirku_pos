import io
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field

from lib.audit import log_activity
from lib.auth import Principal, mask_cost, require
from lib.db import db
from lib.scoped import ScopedRepo, scoped_repo
from models.transaction import CartItemIn, CheckoutIn, Transaction, TransactionItemOut, VoidIn
from models.transaction_report import TransactionRangeReport

router = APIRouter(prefix="/transactions")
WIB = ZoneInfo("Asia/Jakarta")

# Accessories use quantities; handphones and voucher data are tracked per scanned unit.
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
            "due_date": _aware(doc["due_date"]) if doc.get("due_date") else None,
            "piutang_paid_at": _aware(doc["piutang_paid_at"]) if doc.get("piutang_paid_at") else None,
            "profit": mask_cost(principal, doc.get("profit", 0)),
            "status": doc.get("status") or "selesai",
            "void_reason": doc.get("void_reason", ""),
            "voided_by": doc.get("voided_by", ""),
            "voided_at": _aware(doc["voided_at"]) if doc.get("voided_at") else None,
        }
    )


def _range_filter(start: str, end: str) -> dict:
    """Database filter for a YYYY-MM-DD..YYYY-MM-DD range, inclusive, in shop time.

    Dates are parsed server-side (WIB) so a report never shifts with the device clock.
    """
    bounds: dict = {}
    try:
        if start:
            begin = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=WIB)
            bounds["$gte"] = begin.astimezone(timezone.utc)
        if end:
            finish = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=WIB) + timedelta(days=1)
            bounds["$lt"] = finish.astimezone(timezone.utc)
    except ValueError:
        raise HTTPException(status_code=422, detail="Format tanggal harus YYYY-MM-DD")
    if "$gte" in bounds and "$lt" in bounds and bounds["$gte"] >= bounds["$lt"]:
        raise HTTPException(status_code=400, detail="Tanggal awal tidak boleh melewati tanggal akhir")
    return bounds


def _is_serialized(product: dict, item: CartItemIn) -> bool:
    """Phones and IMEI-tracked products always sell per unit; a count-based voucher sells per unit only when a scanned unit is picked."""
    if product["type"] == "handphone" or product.get("track_imei", False):
        return True
    return product["type"] == "voucher" and bool(item.unit_id)


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
    piutang_status: str = "",
    q: str = "",
    start: str = "",
    end: str = "",
    principal: Principal = Depends(require("transaction:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    query: dict = {}
    now = datetime.now(timezone.utc)
    if start or end:
        # explicit date range (YYYY-MM-DD, shop timezone) wins over the period chips
        query["created_at"] = _range_filter(start, end)
    elif period == "today":
        start_wib = now.astimezone(WIB).replace(hour=0, minute=0, second=0, microsecond=0)
        query["created_at"] = {"$gte": start_wib.astimezone(timezone.utc)}
    elif period == "7d":
        query["created_at"] = {"$gte": now - timedelta(days=7)}
    elif period == "30d":
        query["created_at"] = {"$gte": now - timedelta(days=30)}
    elif period == "all":
        pass  # no date filter
    if method in ("tunai", "qris", "piutang"):
        query["payment_method"] = method
    if piutang_status in ("unpaid", "paid"):
        query["piutang_status"] = piutang_status
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



@router.get("/report", response_model=TransactionRangeReport)
async def transactions_range_report(
    start: str = "",
    end: str = "",
    method: str = "",
    principal: Principal = Depends(require("report:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Totals for an explicit date range. Voided sales are counted separately, never in the money."""
    query: dict = {}
    if start or end:
        query["created_at"] = _range_filter(start, end)
    if method in ("tunai", "qris", "piutang"):
        query["payment_method"] = method

    docs = await repo.find("transactions", query).to_list(20000)
    report = TransactionRangeReport(
        start=start, end=end, transaction_count=0, void_count=0, total_revenue=0,
        total_cogs=0, total_profit=0, total_discount=0, items_sold=0, cash_total=0, qris_total=0, piutang_total=0,
        piutang_paid=0, piutang_unpaid=0,
    )
    for doc in docs:
        if (doc.get("status") or "selesai") == "void":
            report.void_count += 1
            continue
        report.transaction_count += 1
        report.total_revenue += doc["total"]
        report.total_discount += doc.get("discount_total", 0)
        for item in doc["items"]:
            report.total_cogs += int(item.get("cost") or 0) * item["qty"]
            report.items_sold += item["qty"]
        if doc["payment_method"] == "tunai":
            report.cash_total += doc["total"]
        elif doc["payment_method"] == "qris":
            report.qris_total += doc["total"]
        else:
            report.piutang_total += doc["total"]
            paid = min(doc["total"], max(0, int(doc.get("amount_paid") or 0)))
            report.piutang_paid += paid
            report.piutang_unpaid += doc["total"] - paid
    report.total_profit = report.total_revenue - report.total_cogs
    return report


@router.get("/report/xlsx")
async def export_range_xlsx(
    start: str = "",
    end: str = "",
    method: str = "",
    principal: Principal = Depends(require("report:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Excel workbook for the selected range: a totals sheet plus one row per sale."""
    query: dict = {}
    if start or end:
        query["created_at"] = _range_filter(start, end)
    if method in ("tunai", "qris", "piutang"):
        query["payment_method"] = method

    docs = await repo.find("transactions", query).sort("created_at", -1).to_list(20000)

    rows = []
    revenue = cogs = discount = items_sold = cash = qris = piutang = piutang_paid = piutang_unpaid = voided = 0
    for doc in docs:
        is_void = (doc.get("status") or "selesai") == "void"
        doc_cogs = sum(int(i.get("cost") or 0) * i["qty"] for i in doc["items"])
        created = doc["created_at"]
        created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
        rows.append(
            {
                "No. Struk": doc["transaction_number"],
                "Tanggal": created.astimezone(WIB).strftime("%d/%m/%Y %H:%M"),
                "Status": "Dibatalkan" if is_void else "Selesai",
                "Kasir": doc.get("cashier_name", ""),
                "Pembeli": doc.get("customer_name") or "-",
                "Pembayaran": {"tunai": "Tunai", "qris": "QRIS", "piutang": "Piutang"}.get(doc["payment_method"], doc["payment_method"]),
                "Subtotal": doc.get("gross_total", doc["total"]),
                "Diskon": doc.get("discount_total", 0),
                "Total": doc["total"],
                "Modal (HPP)": doc_cogs,
                "Laba": doc["total"] - doc_cogs,
                "Rincian Barang": "\n".join(
                    f"{i.get('product_name')} x{i.get('qty')} @{i.get('price')}"
                    + (f" (IMEI {i['imei']})" if i.get("imei") else "")
                    for i in doc["items"]
                ),
                "Alasan Pembatalan": doc.get("void_reason", ""),
            }
        )
        if is_void:
            voided += 1
            continue
        revenue += doc["total"]
        cogs += doc_cogs
        discount += doc.get("discount_total", 0)
        items_sold += sum(i["qty"] for i in doc["items"])
        if doc["payment_method"] == "tunai":
            cash += doc["total"]
        elif doc["payment_method"] == "qris":
            qris += doc["total"]
        else:
            piutang += doc["total"]
            paid = min(doc["total"], max(0, int(doc.get("amount_paid") or 0)))
            piutang_paid += paid
            piutang_unpaid += doc["total"] - paid

    summary = [
        {"Keterangan": "Periode", "Nilai": f"{start or 'awal'} s/d {end or 'hari ini'}"},
        {"Keterangan": "Jumlah transaksi", "Nilai": len(rows) - voided},
        {"Keterangan": "Transaksi dibatalkan", "Nilai": voided},
        {"Keterangan": "Item terjual", "Nilai": items_sold},
        {"Keterangan": "Omzet", "Nilai": revenue},
        {"Keterangan": "Modal / HPP", "Nilai": cogs},
        {"Keterangan": "Keuntungan", "Nilai": revenue - cogs},
        {"Keterangan": "Total diskon", "Nilai": discount},
        {"Keterangan": "Tunai", "Nilai": cash},
        {"Keterangan": "QRIS", "Nilai": qris},
        {"Keterangan": "Piutang", "Nilai": piutang},
        {"Keterangan": "Piutang Lunas", "Nilai": piutang_paid},
        {"Keterangan": "Sisa Piutang", "Nilai": piutang_unpaid},
    ]

    buffer = io.BytesIO()
    workbook = Workbook()
    summary_sheet = workbook.active
    summary_sheet.title = "Ringkasan"
    summary_headers = ["Keterangan", "Nilai"]
    summary_sheet.append(summary_headers)
    for row in summary:
        summary_sheet.append([row[header] for header in summary_headers])

    detail_sheet = workbook.create_sheet("Transaksi")
    detail_headers = list(rows[0]) if rows else [
        "No. Struk", "Tanggal", "Status", "Kasir", "Pembeli", "Pembayaran", "Subtotal", "Diskon",
        "Total", "Modal (HPP)", "Laba", "Rincian Barang", "Alasan Pembatalan",
    ]
    detail_sheet.append(detail_headers)
    for row in rows:
        detail_sheet.append([row.get(header, "") for header in detail_headers])
    detail_sheet.freeze_panes = "A2"

    for sheet in (summary_sheet, detail_sheet):
        for index, header in enumerate(sheet[1], start=1):
            widest = max(len(str(header.value)), *(len(str(cell.value)[:40]) for cell in list(sheet.columns)[index - 1][1:201]))
            sheet.column_dimensions[get_column_letter(index)].width = min(widest + 3, 42)
    workbook.save(buffer)

    label = f"{start or 'awal'}_{end or 'kini'}"
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="kasirku-transaksi-{label}.xlsx"'},
    )


@router.post("", response_model=Transaction, status_code=201)
@db.transactional
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
        serialized = _is_serialized(product, item)
        if product["type"] == "non_fisik":
            target = (item.service_target or "").strip()
            service_category = product.get("service_category")
            if not target:
                raise HTTPException(status_code=400, detail=f"Nomor tujuan wajib diisi untuk {product['name']}")
            if service_category in {"pulsa", "pln"} and not target.isdigit():
                raise HTTPException(status_code=400, detail="Nomor tujuan harus berupa angka")
            if service_category == "pulsa" and not 9 <= len(target) <= 16:
                raise HTTPException(status_code=400, detail="Nomor HP harus 9–16 digit")
            if service_category == "pln" and not 11 <= len(target) <= 13:
                raise HTTPException(status_code=400, detail="Nomor meter / ID pelanggan PLN harus 11–13 digit")
            if service_category == "ewallet" and (item.service_amount or 0) < 1000:
                raise HTTPException(status_code=400, detail="Nominal E-Wallet minimal Rp1.000")
        elif serialized:
            if not item.unit_id:
                label = "unit barcode" if product["type"] == "voucher" else "unit IMEI"
                raise HTTPException(status_code=400, detail=f"{label} wajib dipilih untuk {product['name']}")
            unit = units_by_id.get(item.unit_id)
            if not unit:
                raise HTTPException(status_code=404, detail=f"Unit tidak ditemukan untuk {product['name']}")
            if unit["status"] != "in_stock":
                code = unit.get("barcode") or unit.get("imei")
                raise HTTPException(status_code=409, detail=f"Barcode/IMEI {code} sudah terjual")
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
        serialized = _is_serialized(product, item)
        service_amount = None
        if serialized:
            unit = units_by_id[item.unit_id]
            # Serialized phones and data-voucher codes may carry their own cost and sell price.
            tier = item.price_tier if product["type"] == "voucher" else "ritel"
            price = int(unit.get("sell_price") or 0) or _tier_price(product, tier)
            cost = int(unit.get("cost_price") or 0) or product.get("cost_price", 0)
            qty = 1
        elif product["type"] == "non_fisik":
            unit = None
            tier = "ritel"
            service_amount = item.service_amount if product.get("service_category") == "ewallet" else product.get("denomination")
            price = item.service_amount if product.get("service_category") == "ewallet" else product["sell_price"]
            cost = product.get("cost_price", 0)
            qty = 1
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
                    barcode=unit.get("barcode") if unit else None,
                    color=unit.get("color", "") if unit else None,
                    capacity=unit.get("capacity", "") if unit else None,
                    service_category=product.get("service_category"),
                    provider=product.get("provider") if product["type"] == "non_fisik" else None,
                    service_target=item.service_target.strip() if item.service_target else None,
                    service_amount=service_amount,
                    pln_token=None,
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
        change = paid - total
    elif input.payment_method == "piutang":
        # Credit sale: may be fully unpaid (amount_paid=0) or partially settled.
        paid = input.amount_paid or 0
        if paid > total:
            raise HTTPException(status_code=400, detail="Uang muka melebihi total transaksi")
        change = max(0, paid - total)
    else:
        paid = total
        change = 0

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
                    raise HTTPException(
                        status_code=409,
                        detail=f"Barcode/IMEI {unit.get('barcode') or unit['imei']} sudah terjual",
                    )
                claimed_units.append(unit["id"])
            elif product["type"] != "non_fisik":
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
        change_amount=change,
        customer_name=input.customer_name.strip(),
        customer_phone=input.customer_phone.strip(),
        cashier_name=principal.name,  # server-derived, never client-supplied
        client_ref=input.client_ref,
        created_at=input.offline_created_at or now,
        due_date=input.due_date if input.payment_method == "piutang" else None,
        piutang_status=("paid" if paid >= total else "unpaid") if input.payment_method == "piutang" else None,
        piutang_paid_at=(now if input.payment_method == "piutang" and paid >= total else None),
    )
    await repo.insert_one("transactions", trx.model_dump(exclude={"store_id"}))
    return _trx_out(trx.model_dump(), principal)


@router.post("/{transaction_id}/void", response_model=Transaction)
@db.transactional
async def void_transaction(
    transaction_id: str,
    input: VoidIn,
    principal: Principal = Depends(require("transaction:void")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Cancel (void) or return (retur) a sale: stock goes back, the record stays.

    The transaction is never deleted — reports skip voided rows, and the audit trail keeps
    who cancelled it and why.
    """
    doc = await repo.find_one("transactions", {"id": transaction_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if (doc.get("status") or "selesai") == "void":
        raise HTTPException(status_code=409, detail="Transaksi ini sudah dibatalkan sebelumnya")

    now = datetime.now(timezone.utc)
    # Flag first: a matched update guarantees only one void wins if two owners click at once.
    claimed = await repo.update_one(
        "transactions",
        {"id": transaction_id, "status": {"$ne": "void"}},
        {
            "$set": {
                "status": "void",
                "void_type": input.void_type,
                "void_reason": input.reason.strip(),
                "voided_by": principal.name,
                "voided_at": now,
            }
        },
    )
    if claimed.matched_count == 0:
        raise HTTPException(status_code=409, detail="Transaksi ini sudah dibatalkan sebelumnya")

    # Then return the goods to stock: IMEI units become sellable again, quantities go up.
    for item in doc["items"]:
        if item.get("unit_id"):
            await repo.update_one(
                "product_units",
                {"id": item["unit_id"]},
                {"$set": {"status": "in_stock", "sold_at": None, "transaction_id": None}},
            )
        elif not item.get("service_category"):
            await repo.update_one("products", {"id": item["product_id"]}, {"$inc": {"stock_qty": item["qty"]}})

    label = "Retur" if input.void_type == "retur" else "Void"
    await log_activity(
        principal,
        "transaction:void",
        summary=f"{label} transaksi {doc['transaction_number']} ({doc['total']:,}".replace(",", ".")
        + f") — alasan: {input.reason.strip()}. Stok dikembalikan.",
        entity_name=doc["transaction_number"],
        category="stok",
    )

    updated = await repo.find_one("transactions", {"id": transaction_id})
    return _trx_out(updated or doc, principal)


class PiutangSettleIn(BaseModel):
    amount: int = Field(gt=0)


class PlnTokenIn(BaseModel):
    token: str = Field(pattern=r"^\d{20}$")


@router.patch("/{transaction_id}/items/{item_index}/pln-token", response_model=Transaction)
@db.transactional
async def save_pln_token(
    transaction_id: str,
    item_index: int,
    input: PlnTokenIn,
    principal: Principal = Depends(require("transaction:create")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    doc = await repo.find_one("transactions", {"id": transaction_id})
    if not doc or item_index < 0 or item_index >= len(doc.get("items", [])):
        raise HTTPException(status_code=404, detail="Item transaksi tidak ditemukan")
    items = list(doc["items"])
    if items[item_index].get("service_category") != "pln":
        raise HTTPException(status_code=400, detail="Item ini bukan transaksi listrik PLN")
    items[item_index] = {**items[item_index], "pln_token": input.token}
    await repo.update_one("transactions", {"id": transaction_id}, {"$set": {"items": items}})
    updated = await repo.find_one("transactions", {"id": transaction_id})
    return _trx_out(updated or doc, principal)


@router.post("/{transaction_id}/settle", response_model=Transaction)
@db.transactional
async def settle_piutang(
    transaction_id: str,
    input: PiutangSettleIn,
    principal: Principal = Depends(require("transaction:create")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Mark a piutang transaction as paid (fully or partially settled)."""
    await repo.lock_one("transactions", {"id": transaction_id})
    doc = await repo.find_one("transactions", {"id": transaction_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if doc.get("payment_method") != "piutang":
        raise HTTPException(status_code=400, detail="Bukan transaksi piutang")
    if doc.get("piutang_status") == "paid":
        raise HTTPException(status_code=400, detail="Piutang sudah lunas")
    remaining = max(0, doc["total"] - int(doc.get("amount_paid") or 0))
    if input.amount > remaining:
        raise HTTPException(status_code=400, detail="Pembayaran melebihi sisa piutang")

    # We update the amount_paid. If it reaches total, we mark as paid.
    new_amount = int(doc.get("amount_paid") or 0) + input.amount
    is_paid = new_amount >= doc["total"]
    paid_at = datetime.now(timezone.utc) if is_paid else doc.get("piutang_paid_at")

    update_result = await repo.update_one(
        "transactions",
        {"id": transaction_id, "piutang_status": {"$ne": "paid"}},
        {
            "$set": {
                "amount_paid": new_amount,
                "change_amount": max(0, new_amount - doc["total"]),
                "piutang_status": "paid" if is_paid else "unpaid",
                "piutang_paid_at": paid_at,
            }
        },
    )
    if update_result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Piutang sudah berubah. Muat ulang transaksi.")

    await log_activity(
        principal,
        "transaction:settle",
        summary=f"Pembayaran piutang {doc['transaction_number']} sejumlah {input.amount:,}".replace(",", "."),
        entity_name=doc["transaction_number"],
        category="toko",
    )

    updated = await repo.find_one("transactions", {"id": transaction_id})
    return _trx_out(updated, principal)
