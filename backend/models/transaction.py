import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CartItemIn(BaseModel):
    product_id: str
    unit_id: Optional[str] = None  # required for handphone (serialized IMEI unit)
    qty: int = 1


class CheckoutIn(BaseModel):
    items: list[CartItemIn]
    payment_method: Literal["tunai", "qris"] = "tunai"
    amount_paid: Optional[int] = None  # tunai only; QRIS always settles at total
    customer_name: str = ""
    customer_phone: str = ""
    cashier_name: str = "Kasir"


class TransactionItemOut(BaseModel):
    product_id: str
    product_name: str
    unit_id: Optional[str] = None
    imei: Optional[str] = None
    color: Optional[str] = None
    capacity: Optional[str] = None
    qty: int
    price: int
    subtotal: int


class Transaction(BaseModel):
    id: str = Field(default_factory=_uuid)
    transaction_number: str
    items: list[TransactionItemOut]
    total: int
    payment_method: str
    amount_paid: int
    change_amount: int
    customer_name: str = ""
    customer_phone: str = ""
    cashier_name: str = "Kasir"
    created_at: datetime = Field(default_factory=_now)