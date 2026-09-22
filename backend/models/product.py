import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Product(BaseModel):
    id: str = Field(default_factory=_uuid)
    name: str
    brand: str = ""
    type: Literal["handphone", "aksesoris"] = "aksesoris"
    category: str = "Lainnya"
    sku: str = ""
    cost_price: int = 0
    sell_price: int = 0
    # accessories only — handphone stock is the count of in_stock units
    stock_qty: int = 0
    min_stock: int = 5
    is_active: bool = True
    created_at: datetime = Field(default_factory=_now)


class ProductWithStock(Product):
    """Product plus the computed sellable stock (units for phones, qty for accessories)."""

    stock: int = 0


class ProductCreate(BaseModel):
    name: str
    brand: str = ""
    type: Literal["handphone", "aksesoris"] = "aksesoris"
    category: str = "Lainnya"
    sku: str = ""
    cost_price: int = 0
    sell_price: int = 0
    stock_qty: int = 0
    min_stock: int = 5


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    sku: Optional[str] = None
    cost_price: Optional[int] = None
    sell_price: Optional[int] = None
    stock_qty: Optional[int] = None
    min_stock: Optional[int] = None
    is_active: Optional[bool] = None


class ProductUnit(BaseModel):
    id: str = Field(default_factory=_uuid)
    product_id: str
    imei: str
    color: str = ""
    capacity: str = ""
    status: Literal["in_stock", "sold"] = "in_stock"
    created_at: datetime = Field(default_factory=_now)
    sold_at: Optional[datetime] = None
    transaction_id: Optional[str] = None


class ProductUnitCreate(BaseModel):
    imei: str
    color: str = ""
    capacity: str = ""