import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

DiscountType = Literal["nominal", "persen"]
PriceTier = Literal["ritel", "grosir"]


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CartItemIn(BaseModel):
    product_id: str
    unit_id: Optional[str] = None  # required for handphone (serialized IMEI unit)
    qty: int = 1
    # Voucher lines pick a price tier; ignored for other product types.
    price_tier: PriceTier = "ritel"
    # Per-item discount. The server recomputes the money from these two fields —
    # a client-sent subtotal is never trusted.
    discount_type: Optional[DiscountType] = None
    discount_value: int = 0


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
    price: int  # unit price BEFORE discount (tier-aware)
    price_tier: PriceTier = "ritel"
    cost: Optional[int] = 0  # harga modal snapshot; None when masked for Kasir
    discount_type: Optional[DiscountType] = None
    discount_value: int = 0  # as entered: rupiah for "nominal", percent for "persen"
    discount: int = 0  # resolved rupiah taken off this line
    subtotal: int  # qty * price - discount


class VoidIn(BaseModel):
    """Cancel or return a recorded sale. Stock goes back; the record is kept for audit."""

    void_type: Literal["void", "retur"] = "void"
    reason: str = Field(min_length=3, max_length=200)


class Transaction(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str = ""
    transaction_number: str
    items: list[TransactionItemOut]
    gross_total: int = 0  # before discounts
    discount_total: int = 0
    total: int  # after discounts
    profit: Optional[int] = 0  # None when masked for Kasir
    payment_method: str
    amount_paid: int
    change_amount: int
    customer_name: str = ""
    customer_phone: str = ""
    cashier_name: str = "Kasir"
    client_ref: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    # Void/retur bookkeeping — "selesai" is the normal state, legacy rows default to it.
    status: Literal["selesai", "void"] = "selesai"
    void_type: Optional[Literal["void", "retur"]] = None
    void_reason: str = ""
    voided_by: str = ""
    voided_at: Optional[datetime] = None