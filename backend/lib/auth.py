"""Auth primitives: password hashing, JWT issue/verify, server-derived principal, RBAC gate.

Model (deliberately minimal — see memory/spec.md):
  * one user belongs to exactly ONE store (`store_id`), so email is globally unique
  * two tenant roles: "pemilik" (owner) and "kasir" (cashier)
  * there is no platform/super-admin scope
The principal is re-read from PostgreSQL on every request, so a role change or a deleted
user takes effect immediately instead of at token expiry.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import jwt
from fastapi import Depends, HTTPException, Request
from passlib.context import CryptContext
from pydantic import BaseModel

from lib.db import db

Role = Literal["pemilik", "kasir"]

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 30


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured in backend/.env")
    return secret


def hash_password(raw: str) -> str:
    # bcrypt silently truncates beyond 72 bytes; reject early instead of hashing a prefix
    if len(raw.encode()) > 72:
        raise HTTPException(status_code=400, detail="Password terlalu panjang (maks 72 karakter)")
    return _pwd.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _pwd.verify(raw, hashed)
    except ValueError:
        return False


def create_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=TOKEN_TTL_DAYS)}
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


class Principal(BaseModel):
    user_id: str
    store_id: str
    role: Role
    name: str
    email: str
    store_name: str


# Layer 1 — what each kind of principal may do. Deny-by-default: an action absent here is refused.
PERMISSIONS: dict[str, set[str]] = {
    "pemilik": {
        "product:read",
        "product:write",
        "transaction:create",
        "transaction:read",
        "report:read",
        "user:manage",
        "transaction:void",
        "cost:read",  # harga modal & laba
    },
    "kasir": {
        "product:read",
        "transaction:create",
        "transaction:read",
    },
}

CREDENTIALS_ERROR = HTTPException(
    status_code=401,
    detail="Sesi tidak valid atau sudah berakhir. Silakan login kembali.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise CREDENTIALS_ERROR
    return token.strip()


async def get_principal(request: Request) -> Principal:
    """Build the principal from the verified token + the CURRENT user/store rows."""
    token = _bearer_token(request)
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise CREDENTIALS_ERROR

    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise CREDENTIALS_ERROR

    user = await db.users.find_one({"id": user_id, "is_active": True})
    if not user:
        raise CREDENTIALS_ERROR
    store = await db.stores.find_one({"id": user["store_id"]})
    if not store:
        raise CREDENTIALS_ERROR

    return Principal(
        user_id=user["id"],
        store_id=user["store_id"],
        role=user["role"],
        name=user["name"],
        email=user["email"],
        store_name=store["name"],
    )


def can(principal: Principal, action: str) -> bool:
    return action in PERMISSIONS.get(principal.role, set())


def require(action: str):
    """Route gate: `dependencies=[Depends(require("report:read"))]`.

    A role that may not perform the action gets 403 (it can see the feature exists but
    is not allowed); cross-store data is hidden by the scoped repo as 404 instead.
    """

    async def _dep(principal: Principal = Depends(get_principal)) -> Principal:
        if not can(principal, action):
            raise HTTPException(status_code=403, detail="Akses ditolak: hanya untuk Pemilik toko")
        return principal

    return _dep


def mask_cost(principal: Principal, value: Optional[int]) -> Optional[int]:
    """Field-level allow-list: Kasir never receives harga modal / laba."""
    return value if can(principal, "cost:read") else None