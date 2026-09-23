import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Store(BaseModel):
    id: str = Field(default_factory=_uuid)
    name: str
    address: str = ""
    phone: str = ""
    # editable receipt footer: warranty note + closing greeting
    receipt_warranty: str = "Garansi resmi toko 7 hari (tukar unit bila ada cacat pabrik)."
    receipt_thanks: str = "Terima kasih telah berbelanja!"
    created_at: datetime = Field(default_factory=_now)


class User(BaseModel):
    """One user belongs to exactly one store; `role` is the tenant role."""

    id: str = Field(default_factory=_uuid)
    store_id: str
    name: str
    email: str
    password_hash: str
    role: Literal["pemilik", "kasir"] = "kasir"
    is_active: bool = True
    created_at: datetime = Field(default_factory=_now)


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: Literal["pemilik", "kasir"]
    is_active: bool
    created_at: datetime


class RegisterIn(BaseModel):
    store_name: str = Field(min_length=2, max_length=80)
    store_address: str = ""
    store_phone: str = ""
    name: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class CreateUserIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    role: Literal["pemilik", "kasir"] = "kasir"


class UpdateUserIn(BaseModel):
    """Rename an account so it matches how the shop refers to the person
    (e.g. "Kasir Pagi", "Admin Toko Cabang 2"). The name is what prints on receipts."""

    name: str = Field(min_length=2, max_length=60)
    # Login email; also where the weekly report is sent. Omitted = keep the current one.
    email: Optional[EmailStr] = None


class ResetPasswordIn(BaseModel):
    """Owner-issued password reset for a staff account (forgotten password / new hire)."""

    password: str = Field(min_length=6, max_length=72)


class StoreUpdateIn(BaseModel):
    """Shop identity printed on the receipt header."""

    name: str = Field(min_length=2, max_length=80)
    address: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=32)
    # receipt footer text; omitted = keep whatever is stored
    receipt_warranty: Optional[str] = Field(default=None, max_length=200)
    receipt_thanks: Optional[str] = Field(default=None, max_length=120)


class SessionOut(BaseModel):
    """Login/register response: the token plus everything the UI needs to render the shell."""

    token: str
    user: UserOut
    store: Store


class MeOut(BaseModel):
    user: UserOut
    store: Store
    permissions: list[str]