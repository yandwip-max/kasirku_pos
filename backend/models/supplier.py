import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Supplier(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    name: str
    phone: str = ""
    address: str = ""
    created_at: datetime = Field(default_factory=_now)


class SupplierWithCount(Supplier):
    product_count: int = 0


class SupplierIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(default="", max_length=30)
    address: str = Field(default="", max_length=200)
