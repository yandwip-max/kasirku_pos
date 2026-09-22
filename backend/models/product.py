import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

# "voucher" (pulsa/data) behaves like an accessory for stock, but carries two price tiers:
# retail (sell_price) and wholesale (wholesale_price) picked per cart line at checkout.
ProductType = Literal["handphone", "aksesoris", "voucher"]
PriceTier = Literal["ritel", "grosir"]


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