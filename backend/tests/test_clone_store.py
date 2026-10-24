"""POST /auth/stores/clone: new store gets a copy of categories + products, nothing else,
edits never leak between stores, and the action is guarded (password confirmation,
lockout, daily cap, owner-only).

Each test registers its own throwaway store so the per-store daily cap and lockout never
touch the shared demo account.
"""
import uuid

import httpx

from tests.helpers import KASIR, auth_headers

PASSWORD = "owner1234"


def _fresh_owner(client: httpx.Client) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:8]
    creds = {"email": f"src-{suffix}@example.com", "password": PASSWORD}
    r = client.post(
        "/auth/register",
        json={"store_name": f"tscheck-src-{suffix}", "name": "Pemilik Src", **creds},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, creds


def _clone_payload(suffix: str, current_password: str = PASSWORD, email: str | None = None) -> dict:
    return {
        "store_name": f"tscheck-clone-{suffix}",
        "name": "Pemilik Clone",
        "email": email or f"clone-{suffix}@example.com",
        "password": "clone1234",
        "current_password": current_password,
    }


def test_clone_copies_catalogue_independently(client: httpx.Client):
    owner, _ = _fresh_owner(client)
    suffix = uuid.uuid4().hex[:8]

    category = client.post("/categories", json={"name": f"Kat {suffix}"}, headers=owner)
    assert category.status_code == 201, category.text
    product = client.post(
        "/products",
        json={"name": f"clone-prod-{suffix}", "category": f"Kat {suffix}", "sell_price": 10000, "stock_qty": 7},
        headers=owner,
    )
    assert product.status_code == 201, product.text
    source_id = product.json()["id"]

    created = client.post("/auth/stores/clone", json=_clone_payload(suffix), headers=owner)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["products_copied"] == 1 and body["categories_copied"] == 1

    new_owner = auth_headers(client, {"email": f"clone-{suffix}@example.com", "password": "clone1234"})
    copied = client.get("/products", headers=new_owner).json()
    assert len(copied) == 1
    assert copied[0]["id"] != source_id
    assert copied[0]["sell_price"] == 10000
    assert copied[0]["stock_qty"] == 0
    assert client.get("/transactions", headers=new_owner).json() == []

    # editing the copy leaves the original untouched
    patched = client.patch(f"/products/{copied[0]['id']}", json={"sell_price": 99000}, headers=new_owner)
    assert patched.status_code == 200, patched.text
    original = [p for p in client.get("/products", headers=owner).json() if p["id"] == source_id][0]
    assert original["sell_price"] == 10000


def test_clone_requires_correct_password_and_locks_out(client: httpx.Client):
    owner, _ = _fresh_owner(client)
    suffix = uuid.uuid4().hex[:8]

    for _ in range(5):
        r = client.post("/auth/stores/clone", json=_clone_payload(suffix, "salah-total"), headers=owner)
        assert r.status_code == 403, r.text
    # the session itself stays valid after wrong confirmations
    assert client.get("/auth/me", headers=owner).status_code == 200

    # 6th attempt is locked out even with the right password
    locked = client.post("/auth/stores/clone", json=_clone_payload(suffix), headers=owner)
    assert locked.status_code == 429, locked.text

    # nothing was created
    login = client.post("/auth/login", json={"email": f"clone-{suffix}@example.com", "password": "clone1234"})
    assert login.status_code == 401


def test_clone_daily_cap(client: httpx.Client):
    owner, _ = _fresh_owner(client)
    for _ in range(3):
        suffix = uuid.uuid4().hex[:8]
        assert client.post("/auth/stores/clone", json=_clone_payload(suffix), headers=owner).status_code == 201
    over = client.post("/auth/stores/clone", json=_clone_payload(uuid.uuid4().hex[:8]), headers=owner)
    assert over.status_code == 429, over.text


def test_clone_rejects_duplicate_email_and_kasir(client: httpx.Client):
    owner, creds = _fresh_owner(client)
    dup = _clone_payload(uuid.uuid4().hex[:8], email=creds["email"])
    assert client.post("/auth/stores/clone", json=dup, headers=owner).status_code == 409

    kasir = auth_headers(client, KASIR)
    payload = _clone_payload(uuid.uuid4().hex[:8])
    assert client.post("/auth/stores/clone", json=payload, headers=kasir).status_code == 403
