from datetime import timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from lib.auth import (
    PERMISSIONS,
    Principal,
    create_token,
    get_principal,
    hash_password,
    require,
    verify_password,
)
from lib.audit import diff_changes, log_activity
from lib.db import db
from models.auth import (
    CreateUserIn,
    LoginIn,
    MeOut,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    Store,
    StoreUpdateIn,
    UpdateUserIn,
    User,
    UserOut,
)

router = APIRouter(prefix="/auth")


def _aware(dt):
    return dt if dt is None or dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _user_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc["role"],
        is_active=doc.get("is_active", True),
        created_at=_aware(doc["created_at"]),
    )


def _store_out(doc: dict) -> Store:
    defaults = Store(id=doc["id"], name=doc["name"], created_at=_aware(doc["created_at"]))
    return Store(
        id=doc["id"],
        name=doc["name"],
        address=doc.get("address", ""),
        phone=doc.get("phone", ""),
        receipt_warranty=doc.get("receipt_warranty") or defaults.receipt_warranty,
        receipt_thanks=doc.get("receipt_thanks") or defaults.receipt_thanks,
        created_at=_aware(doc["created_at"]),
    )


@router.post("/register", response_model=SessionOut, status_code=201)
async def register(input: RegisterIn):
    """Create a brand-new store with its first Pemilik account. Data starts empty and
    is isolated from every other store by `store_id`."""
    email = input.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email sudah terdaftar. Silakan login.")

    store = Store(name=input.store_name.strip(), address=input.store_address.strip(), phone=input.store_phone.strip())
    user = User(
        store_id=store.id,
        name=input.name.strip(),
        email=email,
        password_hash=hash_password(input.password),
        role="pemilik",  # server-assigned: the first account of a store always owns it
    )
    await db.stores.insert_one(store.model_dump())
    await db.users.insert_one(user.model_dump())
    return SessionOut(token=create_token(user.id), user=_user_out(user.model_dump()), store=store)


@router.post("/login", response_model=SessionOut)
async def login(input: LoginIn):
    email = input.email.strip().lower()
    user = await db.users.find_one({"email": email})
    # same message for unknown email and wrong password — no account-existence oracle
    if not user or not verify_password(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Akun ini sudah dinonaktifkan oleh pemilik toko")

    store = await db.stores.find_one({"id": user["store_id"]})
    if not store:
        raise HTTPException(status_code=409, detail="Data toko tidak ditemukan")
    return SessionOut(token=create_token(user["id"]), user=_user_out(user), store=_store_out(store))


@router.get("/me", response_model=MeOut)
async def me(principal: Principal = Depends(get_principal)):
    user = await db.users.find_one({"id": principal.user_id})
    store = await db.stores.find_one({"id": principal.store_id})
    if not user or not store:
        raise HTTPException(status_code=404, detail="Akun tidak ditemukan")
    return MeOut(
        user=_user_out(user),
        store=_store_out(store),
        permissions=sorted(PERMISSIONS.get(principal.role, set())),
    )


@router.get("/users", response_model=List[UserOut])
async def list_users(principal: Principal = Depends(require("user:manage"))):
    docs = await db.users.find({"store_id": principal.store_id}).sort("created_at", 1).to_list(200)
    return [_user_out(d) for d in docs]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(input: CreateUserIn, principal: Principal = Depends(require("user:manage"))):
    email = input.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email sudah dipakai akun lain")
    user = User(
        store_id=principal.store_id,  # stamped from the principal — never from the request body
        name=input.name.strip(),
        email=email,
        password_hash=hash_password(input.password),
        role=input.role,
    )
    await db.users.insert_one(user.model_dump())
    await log_activity(
        principal,
        "user:create",
        summary=f"Menambah pengguna baru dengan peran {user.role.capitalize()}",
        entity_name=user.email,
        category="akun",
    )
    return _user_out(user.model_dump())


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, input: UpdateUserIn, principal: Principal = Depends(require("user:manage"))):
    """Rename an account in this store. Scoped by store_id, so a user from another
    store is simply not found (404, never 403). Renaming yourself is allowed."""
    name = input.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nama minimal 2 karakter")
    user = await db.users.find_one({"id": user_id, "store_id": principal.store_id})
    if not user:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    await db.users.update_one({"id": user_id, "store_id": principal.store_id}, {"$set": {"name": name}})
    await log_activity(
        principal,
        "user:rename",
        summary=f"Mengubah nama pengguna dari \"{user.get('name', '')}\" menjadi \"{name}\"",
        entity_name=user.get("email", ""),
        category="akun",
    )
    return _user_out({**user, "name": name})


@router.patch("/users/{user_id}/password", response_model=UserOut)
async def reset_password(
    user_id: str, input: ResetPasswordIn, principal: Principal = Depends(require("user:manage"))
):
    """Owner resets a staff password (forgotten, or the account is handed to someone new).
    The old password is not required — the owner already proved who they are."""
    user = await db.users.find_one({"id": user_id, "store_id": principal.store_id})
    if not user:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    await db.users.update_one(
        {"id": user_id, "store_id": principal.store_id},
        {"$set": {"password_hash": hash_password(input.password)}},
    )
    await log_activity(
        principal,
        "user:password",
        summary=f"Mengatur ulang password akun {user.get('name', '')}",
        entity_name=user.get("email", ""),
        category="akun",
    )
    return _user_out(user)


@router.patch("/store", response_model=Store)
async def update_store(input: StoreUpdateIn, principal: Principal = Depends(require("user:manage"))):
    """Edit the shop identity printed on the receipt header. Always scoped to the
    caller's own store — a store_id can never be supplied by the client."""
    updates = {
        "name": input.name.strip(),
        "address": input.address.strip(),
        "phone": input.phone.strip(),
    }
    # receipt footer: empty string means "back to the default wording"
    if input.receipt_warranty is not None:
        updates["receipt_warranty"] = input.receipt_warranty.strip()
    if input.receipt_thanks is not None:
        updates["receipt_thanks"] = input.receipt_thanks.strip()
    store = await db.stores.find_one_and_update(
        {"id": principal.store_id}, {"$set": updates}, return_document=ReturnDocument.AFTER
    )
    if not store:
        raise HTTPException(status_code=404, detail="Data toko tidak ditemukan")
    await log_activity(
        principal,
        "store:update",
        summary="Memperbarui profil toko (tercetak di struk)",
        entity_name=updates["name"],
        category="toko",
    )
    return _store_out(store)


@router.patch("/users/{user_id}/deactivate", response_model=UserOut)
async def deactivate_user(user_id: str, principal: Principal = Depends(require("user:manage"))):
    if user_id == principal.user_id:
        raise HTTPException(status_code=409, detail="Tidak bisa menonaktifkan akun sendiri")
    # scoped by store_id: a user from another store is simply not found (404, never 403)
    user = await db.users.find_one({"id": user_id, "store_id": principal.store_id})
    if not user:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    target_active = not user.get("is_active", True)
    await db.users.update_one({"id": user_id, "store_id": principal.store_id}, {"$set": {"is_active": target_active}})
    await log_activity(
        principal,
        "user:status",
        summary=f"{'Mengaktifkan' if target_active else 'Menonaktifkan'} akun {user.get('name', '')}",
        entity_name=user.get("email", ""),
        category="akun",
    )
    return _user_out({**user, "is_active": target_active})