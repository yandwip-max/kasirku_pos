"""Supplier master data. Read for everyone with product access, write for the owner.

Products reference a supplier by id (`supplier_id`) and keep the name in `supplier_name`
so lists render without a join; renaming a supplier updates both. A supplier that still
has products cannot be deleted.
"""

import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from lib.audit import log_activity
from lib.auth import Principal, require
from lib.db import db
from lib.scoped import ScopedRepo, scoped_repo
from models.supplier import Supplier, SupplierIn, SupplierWithCount

router = APIRouter(prefix="/suppliers")


def _exact(name: str) -> dict:
    return {"$regex": f"^{re.escape(name)}$", "$options": "i"}


@router.get("", response_model=List[SupplierWithCount])
async def list_suppliers(
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    docs = await repo.find("suppliers", {}).sort("name", 1).to_list(1000)
    out: list[SupplierWithCount] = []
    for doc in docs:
        count = await repo.count_documents("products", {"supplier_id": doc["id"]})
        out.append(SupplierWithCount(**doc, product_count=count))
    return out


@router.post("", response_model=Supplier, status_code=201)
@db.transactional
async def create_supplier(
    input: SupplierIn,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    name = input.name.strip()
    if await repo.find_one("suppliers", {"name": _exact(name)}):
        raise HTTPException(status_code=409, detail=f'Supplier "{name}" sudah ada')
    doc = Supplier(name=name, phone=input.phone.strip(), address=input.address.strip(), store_id=principal.store_id)
    await repo.insert_one("suppliers", doc.model_dump(exclude={"store_id"}))
    await log_activity(
        principal, "product:create", summary="Menambah supplier", entity_name=name, category="produk"
    )
    return doc


@router.patch("/{supplier_id}", response_model=Supplier)
@db.transactional
async def update_supplier(
    supplier_id: str,
    input: SupplierIn,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    name = input.name.strip()
    if not await repo.find_one("suppliers", {"id": supplier_id}):
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    if await repo.find_one("suppliers", {"name": _exact(name), "id": {"$ne": supplier_id}}):
        raise HTTPException(status_code=409, detail=f'Supplier "{name}" sudah ada')
    doc = await repo.find_one_and_update(
        "suppliers",
        {"id": supplier_id},
        {"$set": {"name": name, "phone": input.phone.strip(), "address": input.address.strip()}},
        return_document=ReturnDocument.AFTER,
    )
    await repo.update_many("products", {"supplier_id": supplier_id}, {"$set": {"supplier_name": name}})
    await log_activity(
        principal, "product:update", summary="Mengubah data supplier", entity_name=name, category="produk"
    )
    return Supplier(**doc)


@router.delete("/{supplier_id}", status_code=204)
@db.transactional
async def delete_supplier(
    supplier_id: str,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    doc = await repo.find_one("suppliers", {"id": supplier_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    used = await repo.count_documents("products", {"supplier_id": supplier_id})
    if used:
        raise HTTPException(
            status_code=409,
            detail=f'Supplier "{doc["name"]}" masih dipakai {used} produk. Ganti supplier produk tersebut dulu.',
        )
    await repo.delete_one("suppliers", {"id": supplier_id})
    await log_activity(
        principal, "product:delete", summary="Menghapus supplier", entity_name=doc["name"], category="produk"
    )
