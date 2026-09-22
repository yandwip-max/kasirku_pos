"""API-bearing coverage for the voucher-pulsa price regression.

Verifies POST /api/products stores exact integer cost/sell/wholesale prices
for a Voucher Pulsa product (the reported bug: thousand-separator strings
being misread as fractional numbers), and that the backend defensively
coerces a genuinely fractional value instead of erroring.
"""

import uuid

import pytest


def _login(client, email="pemilik@demo.id", password="demo1234"):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def owner_token(client):
    return _login(client)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_voucher_product_with_integer_prices(client, owner_token):
    """Plain integers (as the fixed UI now submits) must save exactly, no truncation/rounding."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-voucher-int-{suffix}",
        "brand": "Telkomsel",
        "type": "voucher",
        "sku": f"TSCHECK-VI-{suffix}",
        "cost_price": 13500,
        "sell_price": 16000,
        "wholesale_price": 14000,
        "stock_qty": 100,
        "min_stock": 5,
    }
    r = client.post("/products", json=payload, headers=_auth(owner_token))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["cost_price"] == 13500
    assert body["sell_price"] == 16000
    assert body["wholesale_price"] == 14000
    assert body["stock_qty"] == 100

    # Confirm it is retrievable via GET with the same exact integer values.
    pid = body["id"]
    r2 = client.get("/products", headers=_auth(owner_token))
    assert r2.status_code == 200
    match = next((p for p in r2.json() if p["id"] == pid), None)
    assert match is not None, "created product not found in product list"
    assert match["cost_price"] == 13500
    assert match["sell_price"] == 16000
    assert match["wholesale_price"] == 14000


def test_create_product_with_fractional_price_is_coerced_not_rejected(client, owner_token):
    """Defensive backend behavior: a raw API call sending a fractional number (e.g. 13.5)
    must be rounded/coerced, not rejected with 422 'data tidak valid'."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-voucher-frac-{suffix}",
        "brand": "Telkomsel",
        "type": "voucher",
        "sku": f"TSCHECK-VF-{suffix}",
        "cost_price": 13.5,
        "sell_price": 16.0,
        "wholesale_price": 14.0,
        "stock_qty": 100,
        "min_stock": 5,
    }
    r = client.post("/products", json=payload, headers=_auth(owner_token))
    assert r.status_code == 201, r.text
    body = r.json()
    # Must be coerced to whole rupiah integers - never left as a decimal.
    assert isinstance(body["cost_price"], int) or float(body["cost_price"]).is_integer()
    assert isinstance(body["sell_price"], int) or float(body["sell_price"]).is_integer()
