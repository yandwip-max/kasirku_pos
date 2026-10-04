import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo import DESCENDING, ReturnDocument
from lib.audit import category_for, diff_changes, log_activity
from lib.auth import Principal, can, mask_cost, require
from lib.db import db
from lib.scoped import ScopedRepo, scoped_repo
from models.product import (
    Product,
    ProductCreate,
    ProductScanResult,
    ProductUnit,
    ProductUnitCreate,
    ProductUpdate,
    ProductWithStock,
    VoucherStockAdd,
)

router = APIRouter(prefix="/products")

SERVICE_PROVIDERS = {
    "pulsa": {"Telkomsel", "Indosat Ooredoo Hutchison", "XL Axiata", "Axis", "Smartfren"},
    "ewallet": {"DANA", "GoPay", "OVO", "ShopeePay", "LinkAja"},
    "pln": {"PLN"},
}
PULSA_DENOMINATIONS = {5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 1000000}
PLN_DENOMINATIONS = {5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000}


def _aware(dt):
    from datetime import timezone

    return dt if dt is None or dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _unit_out(doc: dict, principal: Principal) -> ProductUnit:
    return ProductUnit(
        **{
            **doc,
            "created_at": _aware(doc.get("created_at")),
            "sold_at": _aware(doc.get("sold_at")),
            "cost_price": mask_cost(principal, doc.get("cost_price", 0)),
        }
    )


def _product_out(doc: dict, principal: Principal, stock: int) -> ProductWithStock:
    return ProductWithStock(
        **{
            **doc,
            "created_at": _aware(doc.get("created_at")),
            "cost_price": mask_cost(principal, doc.get("cost_price", 0)),
        },
        stock=stock,
    )


@router.get("", response_model=List[ProductWithStock])
async def list_products(
    search: str = "",
    type: str = "",
    category: str = "",
    low_stock: bool = False,
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    query: dict = {}
    if search.strip():
        escaped = re.escape(search.strip())
        unit_ids = [
            u["product_id"]
            for u in await repo.find(
                "product_units",
                {"$or": [
                    {"imei": {"$regex": escaped, "$options": "i"}},
                    {"barcode": {"$regex": escaped, "$options": "i"}},
                ]},
            ).to_list(500)
        ]
        query["$or"] = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"sku": {"$regex": escaped, "$options": "i"}},
            {"brand": {"$regex": escaped, "$options": "i"}},
            {"barcode": {"$regex": escaped, "$options": "i"}},
            {"id": {"$in": unit_ids}},
        ]
    if type in ("handphone", "aksesoris", "voucher", "lainnya", "non_fisik"):
        query["type"] = type
    if category.strip():
        query["category"] = {"$regex": f"^{re.escape(category.strip())}$", "$options": "i"}

    docs = await repo.find("products", query).sort([("type", DESCENDING), ("name", 1)]).to_list(1000)
    counts: dict[str, int] = {}
    async for row in repo.aggregate(
        "product_units",
        [{"$match": {"status": "in_stock"}}, {"$group": {"_id": "$product_id", "count": {"$sum": 1}}}],
    ):
        counts[row["_id"]] = row["count"]

    out = []
    for doc in docs:
        # Voucher data can combine a manual quantity with individually scanned barcodes.
        if doc.get("type") == "voucher":
            stock = doc.get("stock_qty", 0) + counts.get(doc["id"], 0)
        else:
            serialized = doc.get("type") == "handphone" or doc.get("track_imei", False)
            stock = counts.get(doc["id"], 0) if serialized else doc.get("stock_qty", 0)
        if low_stock and (doc.get("type") == "non_fisik" or stock >= doc.get("min_stock", 5)):
            continue
        out.append(_product_out(doc, principal, stock))
    return out


@router.get("/scan/{code}", response_model=ProductScanResult)
async def scan_product(
    code: str,
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Resolve a scanner value to a sellable barcode unit or a product-level barcode/SKU."""
    scanned = code.strip()
    if not scanned:
        raise HTTPException(status_code=400, detail="Barcode kosong")

    unit = await repo.find_one("product_units", {"$or": [{"barcode": scanned}, {"imei": scanned}]})
    if unit:
        if unit.get("status") != "in_stock":
            raise HTTPException(status_code=409, detail="Barcode unit ini sudah terjual")
        product = await repo.find_one("products", {"id": unit["product_id"], "is_active": {"$ne": False}})
        if not product:
            raise HTTPException(status_code=404, detail="Produk untuk barcode tidak ditemukan")
        unit_stock = await repo.count_documents(
            "product_units", {"product_id": product["id"], "status": "in_stock"}
        )
        stock = (
            product.get("stock_qty", 0) + unit_stock
            if product["type"] == "voucher"
            else unit_stock if product["type"] == "handphone" or product.get("track_imei", False) else product.get("stock_qty", 0)
        )
        return ProductScanResult(product=_product_out(product, principal, stock), unit=_unit_out(unit, principal))

    product = await repo.find_one(
        "products",
        {"$or": [{"barcode": scanned}, {"sku": scanned}], "is_active": {"$ne": False}},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Barcode tidak terdaftar")
    if product["type"] == "voucher":
        raise HTTPException(status_code=404, detail="Scan barcode unik pada masing-masing unit voucher data")
    if product["type"] == "handphone" or product.get("track_imei", False):
        stock = await repo.count_documents("product_units", {"product_id": product["id"], "status": "in_stock"})
    else:
        stock = product.get("stock_qty", 0)
    return ProductScanResult(product=_product_out(product, principal, stock), unit=None)


@router.post("", response_model=Product, status_code=201)
@db.transactional
async def create_product(
    input: ProductCreate,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    if input.type == "non_fisik":
        if input.service_category not in SERVICE_PROVIDERS:
            raise HTTPException(status_code=422, detail="Pilih kategori layanan non-fisik")
        if input.provider not in SERVICE_PROVIDERS[input.service_category]:
            raise HTTPException(status_code=422, detail="Provider tidak sesuai kategori layanan")
        if input.service_category == "pulsa" and input.denomination not in PULSA_DENOMINATIONS:
            raise HTTPException(status_code=422, detail="Nominal pulsa tidak tersedia")
        if input.service_category == "pln" and input.denomination not in PLN_DENOMINATIONS:
            raise HTTPException(status_code=422, detail="Nominal listrik PLN tidak tersedia")
        if input.service_category == "ewallet" and (input.denomination or 0) < 1000:
            raise HTTPException(status_code=422, detail="Nominal E-Wallet minimal Rp1.000")
        input.stock_qty = 0
        input.min_stock = 0
        input.track_imei = False
    # Handphones and vouchers always use serialized unit tracking.
    # Accessories/other types use unit tracking only when track_imei=True.
    if input.type == "handphone":
        input.stock_qty = 0  # stock is tracked as serialized units
        input.track_imei = True  # always on for handphones
    if input.type == "voucher":
        # Without IMEI tracking the entered quantity is a pending count; barcodes are
        # registered later in Kelola Unit, each converting one pending count into a unit.
        input.stock_qty = 0 if input.track_imei else max(input.stock_qty, 0)
    if input.track_imei and input.type != "voucher":
        input.stock_qty = 0  # unit-tracked products start with zero qty stock
    # one product name per store: a duplicate would split stock across two rows
    clash = await repo.find_one("products", {"name": {"$regex": f"^{re.escape(input.name.strip())}$", "$options": "i"}})
    if clash:
        raise HTTPException(status_code=409, detail=f'Produk "{input.name.strip()}" sudah ada di daftar produk')
    input.barcode = input.barcode.strip()
    if input.barcode and (
        await repo.find_one("products", {"barcode": input.barcode})
        or await repo.find_one("product_units", {"barcode": input.barcode})
    ):
        raise HTTPException(status_code=409, detail="Barcode sudah digunakan")
    doc = Product(**{**input.model_dump(), "name": input.name.strip()}, store_id=principal.store_id)
    await repo.insert_one("products", doc.model_dump(exclude={"store_id"}))
    await log_activity(
        principal,
        "product:create",
        summary=f"Menambah produk baru ({doc.type}{'·IMEI' if doc.track_imei else ''})",
        entity_name=doc.name,
        category="produk",
    )
    return doc



@router.patch("/{product_id}", response_model=Product)
@db.transactional
async def update_product(
    product_id: str,
    input: ProductUpdate,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    updates = input.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    updates.pop("type", None)  # type is immutable once created
    updates.pop("store_id", None)  # never reassign a product to another store
    if updates.get("name"):
        name = str(updates["name"]).strip()
        clash = await repo.find_one(
            "products",
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "id": {"$ne": product_id}},
        )
        if clash:
            raise HTTPException(status_code=409, detail=f'Produk "{name}" sudah ada di daftar produk')
        updates["name"] = name
    if updates.get("barcode"):
        barcode = str(updates["barcode"]).strip()
        clash = await repo.find_one("products", {"barcode": barcode, "id": {"$ne": product_id}})
        unit_clash = await repo.find_one("product_units", {"barcode": barcode})
        if clash or unit_clash:
            raise HTTPException(status_code=409, detail="Barcode sudah digunakan")
        updates["barcode"] = barcode
    if before := await repo.find_one("products", {"id": product_id}):
        if before.get("type") in {"voucher", "non_fisik"}:
            updates.pop("stock_qty", None)
        if before.get("type") == "non_fisik":
            service_category = updates.get("service_category", before.get("service_category"))
            provider = updates.get("provider", before.get("provider"))
            denomination = updates.get("denomination", before.get("denomination"))
            if service_category not in SERVICE_PROVIDERS or provider not in SERVICE_PROVIDERS[service_category]:
                raise HTTPException(status_code=422, detail="Provider tidak sesuai kategori layanan")
            if service_category == "pulsa" and denomination not in PULSA_DENOMINATIONS:
                raise HTTPException(status_code=422, detail="Nominal pulsa tidak tersedia")
            if service_category == "pln" and denomination not in PLN_DENOMINATIONS:
                raise HTTPException(status_code=422, detail="Nominal listrik PLN tidak tersedia")
            if service_category == "ewallet" and (denomination or 0) < 1000:
                raise HTTPException(status_code=422, detail="Nominal E-Wallet minimal Rp1.000")
    else:
        before = None
    res = await repo.find_one_and_update(
        "products", {"id": product_id}, {"$set": updates}, return_document=ReturnDocument.AFTER
    )
    if not res:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    changes = diff_changes(before or {}, res, updates.keys())
    if changes:
        await log_activity(
            principal,
            "product:update",
            summary="Mengubah data produk",
            entity_name=res.get("name", ""),
            changes=changes,
            category=category_for("product:update", updates.keys()),
        )
    return Product(**{**res, "created_at": _aware(res.get("created_at"))})


@router.delete("/{product_id}", status_code=204)
@db.transactional
async def delete_product(
    product_id: str,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    before = await repo.find_one("products", {"id": product_id})
    res = await repo.delete_one("products", {"id": product_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await repo.delete_many("product_units", {"product_id": product_id})
    await log_activity(
        principal,
        "product:delete",
        summary="Menghapus produk beserta unit stoknya",
        entity_name=(before or {}).get("name", ""),
        category="produk",
    )


@router.get("/{product_id}/units", response_model=List[ProductUnit])
async def list_units(
    product_id: str,
    status: Optional[str] = None,
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    product = await repo.find_one("products", {"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    uses_units = product["type"] in {"handphone", "voucher"} or product.get("track_imei", False)
    if not uses_units:
        raise HTTPException(status_code=409, detail="Produk ini tidak menggunakan sistem unit IMEI")
    if product["type"] == "voucher" and not can(principal, "product:write"):
        raise HTTPException(status_code=403, detail="Daftar barcode voucher hanya dapat dilihat Pemilik")
    query: dict = {"product_id": product_id}
    if status in ("in_stock", "sold"):
        query["status"] = status
    docs = await repo.find("product_units", query).sort([("status", 1), ("created_at", DESCENDING)]).to_list(1000)
    return [_unit_out(doc, principal) for doc in docs]


@router.post("/{product_id}/units", response_model=ProductUnit, status_code=201)
@db.transactional
async def add_unit(
    product_id: str,
    input: ProductUnitCreate,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    product = await repo.find_one("products", {"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    uses_units = product["type"] in {"handphone", "voucher"} or product.get("track_imei", False)
    if not uses_units:
        raise HTTPException(status_code=409, detail="Unit barcode hanya untuk handphone, voucher data, atau aksesoris dengan lacak IMEI aktif")

    imei = input.imei.strip()
    barcode = (input.barcode or "").strip()
    if product["type"] == "voucher":
        if not barcode:
            raise HTTPException(status_code=400, detail="Barcode voucher data wajib diisi")
        imei = barcode
    elif not imei:
        raise HTTPException(status_code=400, detail="Nomor IMEI wajib diisi")

    if barcode and await repo.find_one("product_units", {"barcode": barcode}):
        raise HTTPException(status_code=409, detail=f"Barcode {barcode} sudah terdaftar di toko ini")
    if await repo.find_one("product_units", {"imei": imei}):
        label = "Barcode" if product["type"] == "voucher" else "IMEI"
        raise HTTPException(status_code=409, detail=f"{label} {imei} sudah terdaftar di toko ini")
    if barcode and await repo.find_one("products", {"barcode": barcode}):
        raise HTTPException(status_code=409, detail=f"Barcode {barcode} sudah dipakai produk lain")

    unit = ProductUnit(
        store_id=principal.store_id,
        product_id=product_id,
        imei=imei,
        barcode=barcode or None,
        color=input.color.strip(),
        capacity=input.capacity.strip(),
        cost_price=input.cost_price,
        sell_price=input.sell_price,
    )
    await repo.insert_one("product_units", unit.model_dump(exclude={"store_id"}))
    if product["type"] == "voucher":
        # Existing quantity-only voucher stock is a pending physical count; each scanned
        # code converts one legacy count into a serialized unit without losing inventory.
        await repo.update_one(
            "products",
            {"id": product_id, "stock_qty": {"$gt": 0}},
            {"$inc": {"stock_qty": -1}},
        )
    label = "barcode" if product["type"] == "voucher" else "IMEI"
    await log_activity(
        principal,
        "unit:add",
        summary=f"Stok masuk 1 unit {label} {barcode or imei}",
        entity_name=product.get("name", ""),
        changes=diff_changes({}, unit.model_dump(), ["cost_price", "sell_price", "color", "capacity", "barcode"]),
        category="stok",
    )
    return unit


@router.post("/{product_id}/voucher-stock", response_model=Product)
@db.transactional
async def add_voucher_stock(
    product_id: str,
    input: VoucherStockAdd,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    product = await repo.find_one_and_update(
        "products",
        {"id": product_id, "type": "voucher"},
        {"$inc": {"stock_qty": input.quantity}},
        return_document=ReturnDocument.AFTER,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Produk voucher data tidak ditemukan")
    await log_activity(
        principal,
        "voucher-stock:add",
        summary=f"Menambah stok voucher data {input.quantity} unit secara manual",
        entity_name=product.get("name", ""),
        changes=diff_changes(
            {"stock_qty": product.get("stock_qty", 0) - input.quantity},
            product,
            ["stock_qty"],
        ),
        category="stok",
    )
    return Product(**{**product, "created_at": _aware(product.get("created_at"))})


@router.delete("/{product_id}/units/{unit_id}", status_code=204)
@db.transactional
async def delete_unit(
    product_id: str,
    unit_id: str,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    unit = await repo.find_one("product_units", {"id": unit_id, "product_id": product_id})
    if not unit:
        raise HTTPException(status_code=404, detail="Unit tidak ditemukan")
    if unit["status"] != "in_stock":
        raise HTTPException(status_code=409, detail="Unit sudah terjual, tidak bisa dihapus")
    await repo.delete_one("product_units", {"id": unit_id})
    product = await repo.find_one("products", {"id": product_id})
    await log_activity(
        principal,
        "unit:delete",
        summary=f"Menghapus unit stok IMEI {unit.get('imei', '')}",
        entity_name=(product or {}).get("name", ""),
        category="stok",
    )