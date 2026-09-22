import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pymongo import DESCENDING, ReturnDocument

from lib.auth import Principal, can, mask_cost, require
from lib.scoped import ScopedRepo, scoped_repo
from models.product import (
    Product,
    ProductCreate,
    ProductUnit,
    ProductUnitCreate,
    ProductUpdate,
    ProductWithStock,
)

router = APIRouter(prefix="/products")


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


@router.get("", response_model=List[ProductWithStock])
async def list_products(
    search: str = "",
    type: str = "",
    low_stock: bool = False,
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    query: dict = {}
    if search.strip():
        escaped = re.escape(search.strip())
        unit_ids = [
            u["product_id"]
            for u in await repo.find("product_units", {"imei": {"$regex": escaped, "$options": "i"}}).to_list(500)
        ]
        query["$or"] = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"sku": {"$regex": escaped, "$options": "i"}},
            {"brand": {"$regex": escaped, "$options": "i"}},
            {"id": {"$in": unit_ids}},
        ]
    if type in ("handphone", "aksesoris"):
        query["type"] = type

    docs = await repo.find("products", query).sort([("type", DESCENDING), ("name", 1)]).to_list(1000)

    counts: dict[str, int] = {}
    async for row in repo.aggregate(
        "product_units",
        [{"$match": {"status": "in_stock"}}, {"$group": {"_id": "$product_id", "count": {"$sum": 1}}}],
    ):
        counts[row["_id"]] = row["count"]

    out = []
    for doc in docs:
        stock = counts.get(doc["id"], 0) if doc["type"] == "handphone" else doc.get("stock_qty", 0)
        if low_stock and stock >= doc.get("min_stock", 5):
            continue
        out.append(
            ProductWithStock(
                **{**doc, "created_at": _aware(doc.get("created_at")), "cost_price": mask_cost(principal, doc.get("cost_price", 0))},
                stock=stock,
            )
        )
    return out


@router.post("", response_model=Product, status_code=201)
async def create_product(
    input: ProductCreate,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    if input.type == "handphone":
        input.stock_qty = 0  # stock is tracked as serialized units
    doc = Product(**input.model_dump(), store_id=principal.store_id)
    await repo.insert_one("products", doc.model_dump(exclude={"store_id"}))
    return doc


@router.patch("/{product_id}", response_model=Product)
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
    res = await repo.find_one_and_update(
        "products", {"id": product_id}, {"$set": updates}, return_document=ReturnDocument.AFTER
    )
    if not res:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    return Product(**{**res, "created_at": _aware(res.get("created_at"))})


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    res = await repo.delete_one("products", {"id": product_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await repo.delete_many("product_units", {"product_id": product_id})


@router.get("/{product_id}/units", response_model=List[ProductUnit])
async def list_units(
    product_id: str,
    status: Optional[str] = None,
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    if not await repo.find_one("products", {"id": product_id}):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    query: dict = {"product_id": product_id}
    if status in ("in_stock", "sold"):
        query["status"] = status
    docs = await repo.find("product_units", query).sort([("status", 1), ("created_at", DESCENDING)]).to_list(1000)
    return [_unit_out(doc, principal) for doc in docs]


@router.post("/{product_id}/units", response_model=ProductUnit, status_code=201)
async def add_unit(
    product_id: str,
    input: ProductUnitCreate,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    product = await repo.find_one("products", {"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    if product["type"] != "handphone":
        raise HTTPException(status_code=409, detail="Stok aksesoris diatur lewat jumlah stok, bukan IMEI")
    imei = input.imei.strip()
    if not imei:
        raise HTTPException(status_code=400, detail="IMEI wajib diisi")
    # IMEI is unique per store, so two different stores may hold the same trade-in unit history
    if await repo.find_one("product_units", {"imei": imei}):
        raise HTTPException(status_code=409, detail=f"IMEI {imei} sudah terdaftar di toko ini")
    unit = ProductUnit(
        store_id=principal.store_id,
        product_id=product_id,
        imei=imei,
        color=input.color.strip(),
        capacity=input.capacity.strip(),
        cost_price=input.cost_price,
        sell_price=input.sell_price,
    )
    await repo.insert_one("product_units", unit.model_dump(exclude={"store_id"}))
    return unit


@router.delete("/{product_id}/units/{unit_id}", status_code=204)
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