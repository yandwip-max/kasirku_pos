import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pymongo import DESCENDING, ReturnDocument

from lib.db import db
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


@router.get("", response_model=List[ProductWithStock])
async def list_products(search: str = "", type: str = "", low_stock: bool = False):
    query: dict = {}
    if search.strip():
        escaped = re.escape(search.strip())
        unit_ids = [
            u["product_id"]
            for u in await db.product_units.find({"imei": {"$regex": escaped, "$options": "i"}}).to_list(500)
        ]
        query["$or"] = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"sku": {"$regex": escaped, "$options": "i"}},
            {"brand": {"$regex": escaped, "$options": "i"}},
            {"id": {"$in": unit_ids}},
        ]
    if type in ("handphone", "aksesoris"):
        query["type"] = type

    docs = await db.products.find(query).sort([("type", DESCENDING), ("name", 1)]).to_list(1000)

    counts: dict[str, int] = {}
    async for row in db.product_units.aggregate(
        [{"$match": {"status": "in_stock"}}, {"$group": {"_id": "$product_id", "count": {"$sum": 1}}}]
    ):
        counts[row["_id"]] = row["count"]

    out = []
    for doc in docs:
        stock = counts.get(doc["id"], 0) if doc["type"] == "handphone" else doc.get("stock_qty", 0)
        if low_stock and stock >= doc.get("min_stock", 5):
            continue
        out.append(ProductWithStock(**doc, stock=stock))
    return out


@router.post("", response_model=Product, status_code=201)
async def create_product(input: ProductCreate):
    if input.type == "handphone":
        input.stock_qty = 0  # stock is tracked as serialized units
    doc = Product(**input.model_dump())
    await db.products.insert_one(doc.model_dump())
    return doc


@router.patch("/{product_id}", response_model=Product)
async def update_product(product_id: str, input: ProductUpdate):
    updates = input.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    updates.pop("type", None)  # type is immutable once created
    res = await db.products.find_one_and_update(
        {"id": product_id}, {"$set": updates}, return_document=ReturnDocument.AFTER
    )
    if not res:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    return Product(**res)


@router.delete("/{product_id}", status_code=204)
async def delete_product(product_id: str):
    res = await db.products.delete_one({"id": product_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.product_units.delete_many({"product_id": product_id})


@router.get("/{product_id}/units", response_model=List[ProductUnit])
async def list_units(product_id: str, status: Optional[str] = None):
    query: dict = {"product_id": product_id}
    if status in ("in_stock", "sold"):
        query["status"] = status
    docs = await db.product_units.find(query).sort([("status", 1), ("created_at", DESCENDING)]).to_list(1000)
    out = []
    for doc in docs:
        doc["created_at"] = _aware(doc.get("created_at"))
        doc["sold_at"] = _aware(doc.get("sold_at"))
        out.append(ProductUnit(**doc))
    return out


@router.post("/{product_id}/units", response_model=ProductUnit, status_code=201)
async def add_unit(product_id: str, input: ProductUnitCreate):
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    if product["type"] != "handphone":
        raise HTTPException(status_code=409, detail="Stok aksesoris diatur lewat jumlah stok, bukan IMEI")
    imei = input.imei.strip()
    if not imei:
        raise HTTPException(status_code=400, detail="IMEI wajib diisi")
    if await db.product_units.find_one({"imei": imei}):
        raise HTTPException(status_code=409, detail=f"IMEI {imei} sudah terdaftar")
    unit = ProductUnit(
        product_id=product_id, imei=imei, color=input.color.strip(), capacity=input.capacity.strip()
    )
    await db.product_units.insert_one(unit.model_dump())
    return unit


@router.delete("/{product_id}/units/{unit_id}", status_code=204)
async def delete_unit(product_id: str, unit_id: str):
    unit = await db.product_units.find_one({"id": unit_id, "product_id": product_id})
    if not unit:
        raise HTTPException(status_code=404, detail="Unit tidak ditemukan")
    if unit["status"] != "in_stock":
        raise HTTPException(status_code=409, detail="Unit sudah terjual, tidak bisa dihapus")
    await db.product_units.delete_one({"id": unit_id})