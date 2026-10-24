import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from typing import List, Optional, Union

import google.auth.exceptions
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from fastapi import APIRouter, Depends, HTTPException
from pymongo import DESCENDING, ReturnDocument
from starlette.concurrency import run_in_threadpool

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
from models.audit import ActivityChange
from lib.db import db
from lib.email import email_configured, send_email
from lib.login_verification import (
    LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_SEND_WINDOW,
    LOGIN_CODE_SENDS_PER_WINDOW,
    LOGIN_CODE_TTL,
    hash_login_code,
    login_code_html,
    new_login_code,
)
from lib.scoped import ScopedRepo
from models.category import Category
from models.product import Product
from models.auth import (
    CloneStoreIn,
    CloneStoreOut,
    CreateUserIn,
    GoogleLoginIn,
    LoginChallengeOut,
    LoginIn,
    MeOut,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    Store,
    StoreSecurityUpdateIn,
    StoreUpdateIn,
    StoreScheduleUpdateIn,
    UpdateUserIn,
    User,
    UserOut,
    VerifyLoginIn,
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
        opening_time=doc.get("opening_time", defaults.opening_time),
        closing_time=doc.get("closing_time", defaults.closing_time),
        timezone=doc.get("timezone", defaults.timezone),
        daily_report_enabled=doc.get("daily_report_enabled", defaults.daily_report_enabled),
        login_verification_enabled=doc.get("login_verification_enabled", False),
        created_at=_aware(doc["created_at"]),
    )


@router.post("/register", response_model=SessionOut, status_code=201)
@db.transactional
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


CLONE_DAILY_LIMIT = 3
CLONE_MAX_WRONG_PASSWORDS = 5
CLONE_LOCKOUT = timedelta(minutes=15)


@router.post("/stores/clone", response_model=CloneStoreOut, status_code=201)
async def clone_store(
    input: CloneStoreIn,
    principal: Principal = Depends(require("user:manage")),
):
    """Create a new store with its own Pemilik account, seeded with a *copy* of the caller's
    categories and products. Guarded because it duplicates a shop's whole catalogue:
    owner-only, the owner must re-enter their own password (a stolen/left-open session is not
    enough), wrong passwords lock the action briefly, and clones per store are capped per day.
    Every attempt lands in the audit log."""
    now = datetime.now(timezone.utc)
    recent = (
        await db.activity_logs.find(
            {"store_id": principal.store_id, "action": {"$in": ["store:clone", "store:clone_denied"]}}
        )
        .sort([("at", DESCENDING)])
        .limit(100)
        .to_list(100)
    )
    denied = [
        r for r in recent
        if r["action"] == "store:clone_denied" and r.get("actor_id") == principal.user_id
        and now - _aware(r["at"]) < CLONE_LOCKOUT
    ]
    if len(denied) >= CLONE_MAX_WRONG_PASSWORDS:
        raise HTTPException(status_code=429, detail="Terlalu banyak percobaan password salah. Coba lagi dalam 15 menit.")
    cloned_today = [r for r in recent if r["action"] == "store:clone" and now - _aware(r["at"]) < timedelta(days=1)]
    if len(cloned_today) >= CLONE_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail=f"Batas pembuatan toko baru {CLONE_DAILY_LIMIT} kali per hari tercapai.")

    me = await db.users.find_one({"id": principal.user_id, "store_id": principal.store_id})
    # 403 (not 401): the session is valid, only the confirmation failed — the UI must not log out
    if not me or not verify_password(input.current_password, me["password_hash"]):
        await log_activity(
            principal,
            "store:clone_denied",
            summary="Gagal membuat toko baru: konfirmasi password salah",
            entity_name=input.store_name.strip(),
            category="toko",
        )
        raise HTTPException(status_code=403, detail="Password Anda salah. Konfirmasi password diperlukan untuk menyalin data toko.")

    return await _create_cloned_store(input, principal)


@db.transactional
async def _create_cloned_store(input: CloneStoreIn, principal: Principal) -> CloneStoreOut:
    email = input.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email sudah terdaftar. Gunakan email lain untuk toko baru.")

    store = Store(name=input.store_name.strip(), address=input.store_address.strip(), phone=input.store_phone.strip())
    owner = User(
        store_id=store.id,
        name=input.name.strip(),
        email=email,
        password_hash=hash_password(input.password),
        role="pemilik",
    )
    await db.stores.insert_one(store.model_dump())
    await db.users.insert_one(owner.model_dump())

    source = ScopedRepo(principal.store_id)
    target = ScopedRepo(store.id)

    categories = [
        Category(name=doc["name"]).model_dump(exclude={"store_id"})
        for doc in await source.find("categories", {}).sort("name", 1).to_list(1000)
    ]
    if categories:
        await target.insert_many("categories", categories)

    products = []
    for doc in await source.find("products", {}).to_list(100000):
        copy = Product.model_validate({**doc, "id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc)})
        copy.stock_qty = 0  # physical stock belongs to each shop; only the catalogue is shared
        products.append(copy.model_dump(exclude={"store_id"}))
    if products:
        await target.insert_many("products", products)

    await log_activity(
        principal,
        "store:clone",
        summary=f"Membuat toko baru dari salinan produk: {store.name}",
        entity_name=store.name,
        category="toko",
    )
    return CloneStoreOut(
        store=store,
        owner=_user_out(owner.model_dump()),
        categories_copied=len(categories),
        products_copied=len(products),
    )


@router.post("/login", response_model=Union[SessionOut, LoginChallengeOut])
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
    if store.get("login_verification_enabled"):
        # password alone is not enough: no token until the emailed code is confirmed
        return await _start_login_challenge(user, store)
    return SessionOut(token=create_token(user["id"]), user=_user_out(user), store=_store_out(store))


def _mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}{'*' * max(len(name) - 2, 1)}@{domain}"


async def _start_login_challenge(user: dict, store: dict) -> LoginChallengeOut:
    now = datetime.now(timezone.utc)
    recent = await db.login_challenges.find({"user_id": user["id"]}).sort([("created_at", DESCENDING)]).limit(10).to_list(10)
    window = [c for c in recent if now - _aware(c["created_at"]) < LOGIN_CODE_SEND_WINDOW]
    if len(window) >= LOGIN_CODE_SENDS_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Terlalu banyak permintaan kode. Coba lagi dalam beberapa menit.")
    if not email_configured():
        raise HTTPException(status_code=503, detail="Pengiriman email belum dikonfigurasi di server. Hubungi admin.")

    challenge_id = secrets.token_urlsafe(32)
    code = new_login_code()
    await db.login_challenges.insert_one({
        "id": challenge_id,
        "store_id": store["id"],
        "user_id": user["id"],
        "code_hash": hash_login_code(challenge_id, code),
        "attempts": 0,
        "created_at": now,
    })
    sent = await send_email(
        to=user["email"],
        subject=f"Kode verifikasi login {store.get('name', 'KasirKu')}",
        html=login_code_html(store.get("name", "toko Anda"), user.get("name", ""), code),
    )
    if not sent:
        await db.login_challenges.delete_one({"id": challenge_id})
        raise HTTPException(status_code=503, detail="Gagal mengirim kode ke email. Coba lagi sebentar lagi.")
    return LoginChallengeOut(
        challenge_id=challenge_id,
        email_hint=_mask_email(user["email"]),
        expires_in=int(LOGIN_CODE_TTL.total_seconds()),
    )


@db.transactional
async def _consume_login_challenge(challenge_id: str, code: str) -> tuple[str, Optional[dict], int]:
    """Check a code under a row lock so concurrent guesses cannot exceed the attempt cap.
    Returns (status, challenge, attempts_left); never raises, so the attempt counter always commits."""
    if not await db.login_challenges.lock_one({"id": challenge_id}):
        return "gone", None, 0
    challenge = await db.login_challenges.find_one({"id": challenge_id})
    if not challenge or datetime.now(timezone.utc) - _aware(challenge["created_at"]) > LOGIN_CODE_TTL:
        await db.login_challenges.delete_one({"id": challenge_id})
        return "gone", None, 0

    attempts = int(challenge.get("attempts", 0)) + 1
    if hmac.compare_digest(challenge["code_hash"], hash_login_code(challenge_id, code)):
        await db.login_challenges.delete_one({"id": challenge_id})  # single use
        return "ok", challenge, 0
    if attempts >= LOGIN_CODE_MAX_ATTEMPTS:
        await db.login_challenges.delete_one({"id": challenge_id})
        return "locked", None, 0
    await db.login_challenges.update_one({"id": challenge_id}, {"$set": {"attempts": attempts}})
    return "wrong", None, LOGIN_CODE_MAX_ATTEMPTS - attempts


@router.post("/login/verify", response_model=SessionOut)
async def verify_login(input: VerifyLoginIn):
    status, challenge, left = await _consume_login_challenge(input.challenge_id, input.code)
    if status == "gone":
        raise HTTPException(status_code=410, detail="Kode kedaluwarsa atau tidak valid. Silakan login ulang.")
    if status == "locked":
        raise HTTPException(status_code=429, detail="Terlalu banyak kode salah. Silakan login ulang untuk kode baru.")
    if status == "wrong":
        raise HTTPException(status_code=400, detail=f"Kode salah. Sisa percobaan: {left}.")

    user = await db.users.find_one({"id": challenge["user_id"], "is_active": True})
    store = await db.stores.find_one({"id": challenge["store_id"]})
    if not user or not store:
        raise HTTPException(status_code=410, detail="Kode kedaluwarsa atau tidak valid. Silakan login ulang.")
    return SessionOut(token=create_token(user["id"]), user=_user_out(user), store=_store_out(store))


@router.get("/google/config")
async def google_config():
    return {"client_id": os.environ.get("GOOGLE_CLIENT_ID") or None}


@router.post("/google", response_model=SessionOut)
async def google_login(input: GoogleLoginIn):
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google OAuth belum dikonfigurasi")

    try:
        claims = await run_in_threadpool(
            id_token.verify_oauth2_token,
            input.credential,
            GoogleRequest(),
            client_id,
        )
    except google.auth.exceptions.TransportError as exc:
        raise HTTPException(status_code=502, detail="Tidak dapat memverifikasi akun Google") from exc
    except (ValueError, google.auth.exceptions.GoogleAuthError) as exc:
        raise HTTPException(status_code=401, detail="Identitas Google tidak dapat diverifikasi")
    if claims.get("email_verified") not in {True, "true"} or not claims.get("email"):
        raise HTTPException(status_code=401, detail="Email akun Google belum terverifikasi")

    email = claims["email"].strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="Email Google belum terdaftar. Daftarkan toko terlebih dahulu.")
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

    updates: dict = {"name": name}
    new_email = str(input.email).strip().lower() if input.email else ""
    if new_email and new_email != user.get("email", "").lower():
        # email is the login identity, so it must stay unique across every store
        taken = await db.users.find_one({"email": new_email, "id": {"$ne": user_id}})
        if taken:
            raise HTTPException(status_code=409, detail="Email ini sudah dipakai akun lain")
        updates["email"] = new_email

    await db.users.update_one({"id": user_id, "store_id": principal.store_id}, {"$set": updates})
    if updates.get("email"):
        await log_activity(
            principal,
            "user:rename",
            summary=f"Mengubah email login akun {name} (laporan mingguan ikut pindah)",
            entity_name=new_email,
            changes=[ActivityChange(field="Email", before=user.get("email", "-"), after=new_email)],
            category="akun",
        )
    if name != user.get("name"):
        await log_activity(
            principal,
            "user:rename",
            summary=f"Mengubah nama pengguna dari \"{user.get('name', '')}\" menjadi \"{name}\"",
            entity_name=updates.get("email") or user.get("email", ""),
            category="akun",
        )
    return _user_out({**user, **updates})


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


@router.patch("/store/security", response_model=Store)
async def update_store_security(
    input: StoreSecurityUpdateIn,
    principal: Principal = Depends(require("user:manage")),
):
    """Owner toggle for emailed login codes. Needs the owner's password, and enabling is refused
    unless email can actually be delivered — otherwise nobody could log in afterwards."""
    me = await db.users.find_one({"id": principal.user_id, "store_id": principal.store_id})
    if not me or not verify_password(input.current_password, me["password_hash"]):
        raise HTTPException(status_code=403, detail="Password Anda salah.")

    if input.login_verification_enabled:
        if not email_configured():
            raise HTTPException(status_code=409, detail="Pengiriman email belum dikonfigurasi di server (SMTP_*).")
        sent = await send_email(
            to=principal.email,
            subject=f"Verifikasi login diaktifkan — {principal.store_name}",
            html=(
                "<main style='font-family:Arial,sans-serif;max-width:480px;margin:auto'>"
                f"<h1 style='font-size:18px'>{escape(principal.store_name)}</h1>"
                "<p>Verifikasi email saat login telah diaktifkan. Mulai sekarang setiap login ke toko ini "
                "memerlukan kode 6 digit yang dikirim ke email akun.</p></main>"
            ),
        )
        if not sent:
            raise HTTPException(status_code=502, detail="Email tidak terkirim, verifikasi login tidak diaktifkan.")

    store = await db.stores.find_one_and_update(
        {"id": principal.store_id},
        {"$set": {"login_verification_enabled": input.login_verification_enabled}},
        return_document=ReturnDocument.AFTER,
    )
    if not store:
        raise HTTPException(status_code=404, detail="Data toko tidak ditemukan")
    state = "mengaktifkan" if input.login_verification_enabled else "menonaktifkan"
    await log_activity(
        principal, "store:security", summary=f"Owner {state} verifikasi email saat login",
        entity_name=store.get("name", ""), category="toko",
    )
    return _store_out(store)


@router.patch("/store/schedule", response_model=Store)
async def update_store_schedule(
    input: StoreScheduleUpdateIn,
    principal: Principal = Depends(require("user:manage")),
):
    """Only the store owner can set operating hours and the daily email schedule."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(input.timezone)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=422, detail="Zona waktu tidak dikenal") from exc
    if input.opening_time >= input.closing_time:
        raise HTTPException(status_code=400, detail="Jam buka harus lebih awal dari jam tutup")
    updates = input.model_dump()
    store = await db.stores.find_one_and_update(
        {"id": principal.store_id}, {"$set": updates}, return_document=ReturnDocument.AFTER
    )
    if not store:
        raise HTTPException(status_code=404, detail="Data toko tidak ditemukan")
    await log_activity(
        principal,
        "store:update",
        summary=f"Mengatur jam operasional {updates['opening_time']}–{updates['closing_time']}",
        entity_name=store.get("name", ""),
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