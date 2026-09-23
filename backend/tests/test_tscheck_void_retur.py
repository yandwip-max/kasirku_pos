"""Void/retur transaksi: stok kembali, laporan mengecualikan void, dan proteksi endpoint."""
import uuid

import httpx

from tests.helpers import KASIR, PEMILIK, auth_headers


def _create_aksesoris_transaction(client: httpx.Client, headers: dict) -> tuple[str, int, int]:
    """Creates a fixture accessory product with stock, then sells 2 units. Returns (trx_id, product_id, qty)."""
    suffix = uuid.uuid4().hex[:8]
    product = client.post(
        "/products",
        json={
            "name": f"tscheck-void-aksesoris-{suffix}",
            "type": "aksesoris",
            "category": "Aksesoris",
            "sell_price": 25000,
            "cost_price": 15000,
            "stock_qty": 10,
            "min_stock": 1,
        },
        headers=headers,
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    trx = client.post(
        "/transactions",
        json={
            "items": [{"product_id": product_id, "qty": 2}],
            "payment_method": "tunai",
            "amount_paid": 50000,
        },
        headers=headers,
    )
    assert trx.status_code == 201, trx.text
    return trx.json()["id"], product_id, 2


def _get_product(client: httpx.Client, headers: dict, product_id: str) -> dict:
    resp = client.get("/products", headers=headers)
    assert resp.status_code == 200, resp.text
    return next(p for p in resp.json() if p["id"] == product_id)


def test_void_accessory_restores_stock_and_excludes_from_reports(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    trx_id, product_id, qty = _create_aksesoris_transaction(client, headers)

    stock_before_void = _get_product(client, headers, product_id)["stock_qty"]

    summary_before = client.get("/reports/summary?days=1", headers=headers)
    assert summary_before.status_code == 200, summary_before.text
    revenue_before = summary_before.json()["total_revenue"]

    trx = client.get("/transactions?period=today", headers=headers)
    total = next(t["total"] for t in trx.json() if t["id"] == trx_id)

    void = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "tscheck salah input"},
        headers=headers,
    )
    assert void.status_code == 200, void.text
    body = void.json()
    assert body["status"] == "void"
    assert body["void_type"] == "void"
    assert body["voided_by"] == "Pak Pemilik" or body["voided_by"]

    after = _get_product(client, headers, product_id)
    assert after["stock_qty"] == stock_before_void + qty

    summary_after = client.get("/reports/summary?days=1", headers=headers)
    assert summary_after.json()["total_revenue"] == revenue_before - total


def test_retur_handphone_restores_imei_and_is_resellable(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    suffix = uuid.uuid4().hex[:8]
    product = client.post(
        "/products",
        json={
            "name": f"tscheck-retur-hp-{suffix}",
            "type": "handphone",
            "category": "Handphone",
            "brand": "TestBrand",
            "sell_price": 1000000,
            "cost_price": 700000,
        },
        headers=headers,
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    imei = f"tscheck-{suffix}"
    unit = client.post(
        f"/products/{product_id}/units",
        json={"imei": imei, "color": "Hitam", "capacity": "128GB"},
        headers=headers,
    )
    assert unit.status_code == 201, unit.text
    unit_id = unit.json()["id"]

    trx = client.post(
        "/transactions",
        json={
            "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
            "payment_method": "tunai",
            "amount_paid": 1000000,
        },
        headers=headers,
    )
    assert trx.status_code == 201, trx.text
    trx_id = trx.json()["id"]

    units = client.get(f"/products/{product_id}/units", headers=headers)
    sold_unit = next(u for u in units.json() if u["id"] == unit_id)
    assert sold_unit["status"] == "sold"

    retur = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "retur", "reason": "tscheck unit dikembalikan"},
        headers=headers,
    )
    assert retur.status_code == 200, retur.text
    assert retur.json()["void_type"] == "retur"

    units_after = client.get(f"/products/{product_id}/units", headers=headers)
    restored_unit = next(u for u in units_after.json() if u["id"] == unit_id)
    assert restored_unit["status"] == "in_stock"

    resell = client.post(
        "/transactions",
        json={
            "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
            "payment_method": "tunai",
            "amount_paid": 1000000,
        },
        headers=headers,
    )
    assert resell.status_code == 201, resell.text


def test_void_protections_reason_length_double_void_missing_id_and_kasir_forbidden(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    trx_id, _, _ = _create_aksesoris_transaction(client, headers)

    # reason < 3 chars -> 422
    short_reason = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "ab"},
        headers=headers,
    )
    assert short_reason.status_code == 422, short_reason.text

    # kasir forbidden -> 403
    kasir_headers = auth_headers(client, KASIR)
    kasir_attempt = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "tscheck kasir attempt"},
        headers=kasir_headers,
    )
    assert kasir_attempt.status_code == 403, kasir_attempt.text

    # first void succeeds
    first_void = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "tscheck void pertama"},
        headers=headers,
    )
    assert first_void.status_code == 200, first_void.text

    # second void on same transaction -> 409
    second_void = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "tscheck void kedua"},
        headers=headers,
    )
    assert second_void.status_code == 409, second_void.text

    # nonexistent id -> 404
    missing = client.post(
        "/transactions/tscheck-does-not-exist/void",
        json={"void_type": "void", "reason": "tscheck missing id"},
        headers=headers,
    )
    assert missing.status_code == 404, missing.text


def test_void_activity_logged_with_receipt_number_reason_and_actor(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    trx_id, _, _ = _create_aksesoris_transaction(client, headers)
    trx = client.get("/transactions?period=today", headers=headers)
    trx_number = next(t["transaction_number"] for t in trx.json() if t["id"] == trx_id)

    void = client.post(
        f"/transactions/{trx_id}/void",
        json={"void_type": "void", "reason": "tscheck alasan aktivitas"},
        headers=headers,
    )
    assert void.status_code == 200, void.text

    activity = client.get(f"/activity?q={trx_number}", headers=headers)
    assert activity.status_code == 200, activity.text
    rows = activity.json()["rows"]
    match = next((r for r in rows if trx_number in r.get("summary", "")), None)
    assert match is not None, f"no activity row referencing {trx_number}: {rows}"
    assert "tscheck alasan aktivitas" in match["summary"]
    assert match["actor_name"]
