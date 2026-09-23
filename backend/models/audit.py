import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


ActivityAction = Literal[
    "product:create",
    "product:update",
    "product:delete",
    "unit:add",
    "unit:delete",
    "transaction:void",
    "user:create",
    "user:rename",
    "user:password",
    "user:status",
    "store:update",
]

# Coarse buckets the UI filters on ("harga", "stok", "password", …)
ActivityCategory = Literal["harga", "stok", "produk", "akun", "toko"]


class ActivityChange(BaseModel):
    """One field that moved, rendered as "Harga jual: Rp 1.000 → Rp 1.200"."""

    field: str
    before: str = ""
    after: str = ""


class ActivityLog(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str
    at: datetime = Field(default_factory=_now)
    actor_id: str
    actor_name: str
    actor_role: str
    action: ActivityAction
    category: ActivityCategory
    entity_name: str = ""
    summary: str
    changes: List[ActivityChange] = []


class ActivityLogOut(BaseModel):
    id: str
    at: datetime
    actor_name: str
    actor_role: str
    action: ActivityAction
    category: ActivityCategory
    entity_name: str
    summary: str
    changes: List[ActivityChange]


class ActivityPage(BaseModel):
    rows: List[ActivityLogOut]
    total: int
    has_more: bool
    next_skip: Optional[int] = None
