import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# "voucher" (pulsa/data) behaves like an accessory for stock, but carries two price tiers:
# retail (sell_price) and wholesale (wholesale_price) picked per cart line at checkout.
ProductType = Literal["handphone", "aksesoris", "voucher"]
PriceTier = Literal["ritel", "grosir"]

MONEY_FIELDS = ("cost_price", "sell_price", "wholesale_price", "stock_qty", "min_stock")


def _coerce_rupiah(value):
    """Accept 13500, "13500", "13.500", or 13500.0 — all mean the same rupiah amount.

    A client sending a fractional number (e.g. a locale-formatted "13.500" parsed as
    13.5) would otherwise be rejected as a non-integer, so round instead of failing.
    """
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit())
        return int(digits) if digits else 0
    if isinstance(value, float):
        return int(round(value))
    return value


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Product(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    name: str
    brand: str = ""
    type: ProductType = "aksesoris"
    category: str = "Lainnya"
    sku: str = ""
    cost_price: Optional[int] = 0  # None when masked for Kasir
    sell_price: int = 0  # harga ritel
    wholesale_price: int = 0  # harga grosir (voucher); 0 = ikut harga ritel
    # accessories & vouchers only — handphone stock is the count of in_stock units
    stock_qty: int = 0
    min_stock: int = 5
    is_active: bool = True
    created_at: datetime = Field(default_factory=_now)


class ProductWithStock(Product):
    """Product plus the computed sellable stock (units for phones, qty for the rest)."""

    stock: int = 0


class ProductCreate(BaseModel):
    name: str
    brand: str = ""
    type: ProductType = "aksesoris"
    category: str = "Lainnya"
    sku: str = ""
    cost_price: int = 0
    sell_price: int = 0
    wholesale_price: int = 0
    stock_qty: int = 0
    min_stock: int = 5

    @field_validator(*MONEY_FIELDS, mode="before")
    @classmethod
    def _rupiah(cls, value):
        return _coerce_rupiah(value)


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    sku: Optional[str] = None
    cost_price: Optional[int] = None
    sell_price: Optional[int] = None
    wholesale_price: Optional[int] = None
    stock_qty: Optional[int] = None
    min_stock: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator(*MONEY_FIELDS, mode="before")
    @classmethod
    def _rupiah(cls, value):
        return None if value is None else _coerce_rupiah(value)


class ProductUnit(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    product_id: str
    imei: str
    color: str = ""
    capacity: str = ""
    cost_price: Optional[int] = 0  # per-unit purchase price; 0 = fall back to the product price
    sell_price: int = 0  # per-unit selling price; 0 = fall back to the product price
    status: Literal["in_stock", "sold"] = "in_stock"
    created_at: datetime = Field(default_factory=_now)
    sold_at: Optional[datetime] = None
    transaction_id: Optional[str] = None


class ProductUnitCreate(BaseModel):
    imei: str
    color: str = ""
    capacity: str = ""
    cost_price: int = 0
    sell_price: int = 0

    @field_validator("cost_price", "sell_price", mode="before")
    @classmethod
    def _rupiah(cls, value):
        return _coerce_rupiah(value)