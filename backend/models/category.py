import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Category(BaseModel):
    """A shop-defined product folder (CCTV, Sparepart, Parfum, …). Stock for products in
    a folder is counted per quantity — only handphones are tracked per IMEI."""

    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    name: str
    created_at: datetime = Field(default_factory=_now)


class CategoryWithCount(Category):
    product_count: int = 0


class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=40)
