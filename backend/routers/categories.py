"""Shop-defined product folders (kategori). Read for everyone, write for the owner.

Names are unique per store (case-insensitive) and a folder still holding products
cannot be deleted — the owner moves the products first.
"""

import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from lib.audit import log_activity
from lib.auth import Principal, require
from lib.db import db
from lib.scoped import ScopedRepo, scoped_repo
from models.category import Category, CategoryIn, CategoryWithCount
from models.audit import ActivityChange

router = APIRouter(prefix="/categories")


def _exact(name: str) -> dict:
    """Case-insensitive exact match, so "Parfum" and "parfum" are the same folder."""
    return {"$regex": f"^{re.escape(name)}$", "$options": "i"}


@router.get("", response_model=List[CategoryWithCount])
async def list_categories(
    principal: Principal = Depends(require("product:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    docs = await repo.find("categories", {}).sort("name", 1).to_list(200)
    out: list[CategoryWithCount] = []
    for doc in docs:
        count = await repo.count_documents("products", {"category": _exact(doc["name"])})
        out.append(CategoryWithCount(**doc, product_count=count))
    return out


@router.post("", response_model=Category, status_code=201)
@db.transactional
async def create_category(
    input: CategoryIn,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    name = input.name.strip()
    if await repo.find_one("categories", {"name": _exact(name)}):
        raise HTTPException(status_code=409, detail=f'Folder "{name}" sudah ada')
    doc = Category(name=name, store_id=principal.store_id)
    await repo.insert_one("categories", doc.model_dump(exclude={"store_id"}))
    await log_activity(
        principal, "product:create", summary="Menambah folder produk", entity_name=name, category="produk"
    )
    return doc


@router.patch("/{category_id}", response_model=Category)
@db.transactional
async def rename_category(
    category_id: str,
    input: CategoryIn,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    name = input.name.strip()
    current = await repo.find_one("categories", {"id": category_id})
    if not current:
        raise HTTPException(status_code=404, detail="Folder tidak ditemukan")
    clash = await repo.find_one("categories", {"name": _exact(name), "id": {"$ne": category_id}})
    if clash:
        raise HTTPException(status_code=409, detail=f'Folder "{name}" sudah ada')

    doc = await repo.find_one_and_update(
        "categories", {"id": category_id}, {"$set": {"name": name}}, return_document=ReturnDocument.AFTER
    )
    # keep products pointing at their folder after a rename
    await repo.update_many("products", {"category": _exact(current["name"])}, {"$set": {"category": name}})
    await log_activity(
        principal,
        "product:update",
        summary="Mengganti nama folder produk",
        entity_name=name,
        changes=[ActivityChange(field="Folder", before=current["name"], after=name)],
        category="produk",
    )
    return Category(**doc)


@router.delete("/{category_id}", status_code=204)
@db.transactional
async def delete_category(
    category_id: str,
    principal: Principal = Depends(require("product:write")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    doc = await repo.find_one("categories", {"id": category_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Folder tidak ditemukan")
    used = await repo.count_documents("products", {"category": _exact(doc["name"])})
    if used:
        raise HTTPException(
            status_code=409,
            detail=f'Folder "{doc["name"]}" masih berisi {used} produk. Pindahkan produknya dulu sebelum menghapus folder.',
        )
    await repo.delete_one("categories", {"id": category_id})
    await log_activity(
        principal, "product:delete", summary="Menghapus folder produk", entity_name=doc["name"], category="produk"
    )
