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
    # Offline support: the PWA stamps a client-generated ref + the moment of sale so a
    # queued transaction replays exactly once and keeps its real timestamp.
    client_ref: Optional[str] = None
    offline_created_at: Optional[datetime] = None


class TransactionItemOut(BaseModel):
    product_id: str
    product_name: str
    unit_id: Optional[str] = None
    imei: Optional[str] = None
    color: Optional[str] = None
    capacity: Optional[str] = None
    qty: int
    price: int
    cost: Optional[int] = 0  # harga modal snapshot; None when masked for Kasir
    subtotal: int


class Transaction(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    transaction_number: str
    items: list[TransactionItemOut]
    total: int
    profit: Optional[int] = 0  # None when masked for Kasir
    payment_method: str
    amount_paid: int
    change_amount: int
    customer_name: str = ""
    customer_phone: str = ""
    cashier_name: str = "Kasir"
    client_ref: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)