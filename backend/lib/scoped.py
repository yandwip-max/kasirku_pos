"""Store-scoped Mongo access. Every tenant query goes through here so no route can
forget the `store_id` filter — that omission is the classic multi-tenant data leak.

Routes never touch `db.<collection>` for tenant data directly; they take
`repo: ScopedRepo = Depends(scoped_repo)` and call the same CRUD surface.
"""

from typing import Any, Mapping, Optional, Sequence

from fastapi import Depends

from lib.auth import Principal, get_principal
from lib.db import db

# Collections that hold per-store data. `users`/`stores` are identity and handled in routers/auth.py.
TENANT_COLLECTIONS = {"products", "product_units", "transactions"}


class ScopedRepo:
    def __init__(self, store_id: str) -> None:
        self.store_id = store_id

    def _filter(self, query: Optional[Mapping[str, Any]] = None) -> dict:
        merged = dict(query or {})
        # a caller-supplied store_id can never widen the scope
        merged["store_id"] = self.store_id
        return merged

    def _stamp(self, doc: Mapping[str, Any]) -> dict:
        return {**doc, "store_id": self.store_id}

    def find(self, collection: str, query: Optional[Mapping[str, Any]] = None):
        return db[collection].find(self._filter(query))

    async def find_one(self, collection: str, query: Optional[Mapping[str, Any]] = None):
        return await db[collection].find_one(self._filter(query))

    async def insert_one(self, collection: str, doc: Mapping[str, Any]):
        return await db[collection].insert_one(self._stamp(doc))

    async def insert_many(self, collection: str, docs: Sequence[Mapping[str, Any]]):
        return await db[collection].insert_many([self._stamp(d) for d in docs])

    async def update_one(self, collection: str, query: Mapping[str, Any], update: Mapping[str, Any]):
        return await db[collection].update_one(self._filter(query), update)

    async def find_one_and_update(self, collection: str, query: Mapping[str, Any], update: Mapping[str, Any], **kwargs):
        return await db[collection].find_one_and_update(self._filter(query), update, **kwargs)

    async def delete_one(self, collection: str, query: Mapping[str, Any]):
        return await db[collection].delete_one(self._filter(query))

    async def delete_many(self, collection: str, query: Optional[Mapping[str, Any]] = None):
        return await db[collection].delete_many(self._filter(query))

    async def count_documents(self, collection: str, query: Optional[Mapping[str, Any]] = None) -> int:
        return await db[collection].count_documents(self._filter(query))

    def aggregate(self, collection: str, pipeline: Sequence[Mapping[str, Any]]):
        """Prepend a mandatory store match as stage 0 so $group/$facet only ever see this store."""
        for stage in pipeline:
            if any(key in stage for key in ("$lookup", "$graphLookup", "$unionWith")):
                raise ValueError("Cross-collection stages must be scoped explicitly, not via ScopedRepo")
        return db[collection].aggregate([{"$match": {"store_id": self.store_id}}, *pipeline])


async def scoped_repo(principal: Principal = Depends(get_principal)) -> ScopedRepo:
    return ScopedRepo(principal.store_id)