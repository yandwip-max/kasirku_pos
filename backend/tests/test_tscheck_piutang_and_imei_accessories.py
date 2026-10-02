"""Piutang (credit) payment method and track_imei accessory tests.

Covers:
- Creating an aksesoris product with track_imei=True
- Adding units with IMEI to a track_imei accessory
- Selling a tracked-IMEI accessory + a regular aksesoris in a single receipt
- Selling via "piutang" (credit) with zero down payment
- Selling via "piutang" with partial advance payment
- Daily report / range report showing piutang totals
- Transaction filter by payment_method=piutang
"""
import uuid
from datetime import date

import httpx

from tests.helpers import PEMILIK, auth_headers


def _create_accessory_with_imei(client: httpx.Client, headers: dict, track_imei: bool = True) -> tuple[str, str, int]:
    name = f"tscheck-aksesoris-{uuid.uuid4().hex[:8]}"
    payload = {
        "type": "aksesoris",
        "name": name,
        "cost_price": 20000,
        "sell_price": 50000,
    }
    if track_imei:
        payload["track_imei"] = True
    r = client.post("/products", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    product_id = r.json()["id"]

    imei = f"TS{uuid.uuid4().hex[:12]}"
    r = client.post(
        f"/products/{product_id}/units",
        headers=headers,
        json={"imei": imei, "cost_price": 20000, "sell_price": 50000},
    )
    assert r.status_code == 201, r.text
    unit_id = r.json()["id"]
    return product_id, unit_id, 50000


def test_track_imei_accessory_creation_and_unit_add():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        name = f"tscheck-aksesoris-trimie-{uuid.uuid4().hex[:8]}"
        r = client.post(
            "/products",
            headers=headers,
            json={"type": "aksesoris", "name": name, "cost_price": 20000, "sell_price": 50000, "track_imei": True},
        )
        assert r.status_code == 201, r.text
        product = r.json()
        assert product["track_imei"] is True

        imei = f"TS{uuid.uuid4().hex[:12]}"
        r2 = client.post(
            f"/products/{product['id']}/units",
            headers=headers,
            json={"imei": imei, "cost_price": 20000, "sell_price": 50000},
        )
        assert r2.status_code == 201, r2.text
        assert r2.json()["imei"] == imei


def test_track_imei_accessory_sale_succeeds():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_accessory_with_imei(client, headers, track_imei=True)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "tunai",
                "amount_paid": sell_price,
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["total"] == sell_price
        assert body["change_amount"] == 0

        r2 = client.get(f"/products/{product_id}/units", headers=headers)
        unit = next(u for u in r2.json() if u["id"] == unit_id)
        assert unit["status"] == "sold"


def test_piutang_payment_with_zero_advance():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_accessory_with_imei(client, headers, track_imei=False)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "piutang",
                "customer_name": "Budak Basah",
                "customer_phone": "08123456789",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["payment_method"] == "piutang"
        assert body["total"] == sell_price
        assert body["amount_paid"] == 0
        assert body["change_amount"] == 0


def test_piutang_payment_with_partial_advance():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_accessory_with_imei(client, headers, track_imei=False)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "piutang",
                "amount_paid": sell_price // 2,
                "customer_name": "Budak Basah",
                "customer_phone": "08123456789",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["payment_method"] == "piutang"
        assert body["amount_paid"] == sell_price // 2
        assert body["change_amount"] == 0


def test_piutang_shows_in_daily_report():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_accessory_with_imei(client, headers, track_imei=False)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "piutang",
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 201, r.text

        r2 = client.get("/reports/daily?days=7", headers=headers)
        assert r2.status_code == 200, r2.text
        report = r2.json()
        assert any(row["piutang"] > 0 for row in report["rows"]), f"Expected piutang in daily rows: {report}"


def test_piutang_shows_in_range_report_and_filter():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_accessory_with_imei(client, headers, track_imei=False)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "piutang",
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 201, r.text
        assert r.json()["payment_method"] == "piutang"

        # The piutang transaction should appear when filtered by method=piutang
        r2 = client.get("/transactions?period=30d&method=piutang", headers=headers)
        assert r2.status_code == 200, r2.text
        tx_rows = r2.json()
        piutang_rows = [t for t in tx_rows if t["payment_method"] == "piutang"]
        assert len(piutang_rows) >= 1, f"Expected at least one piutang transaction: {tx_rows}"

        # Range report should include piutang_total
        r3 = client.get(
            f"/transactions/report?start={date.today().isoformat()}&end={date.today().isoformat()}",
            headers=headers,
        )
        assert r3.status_code == 200, r3.text
        range_report = r3.json()
        assert "piutang_total" in range_report
        assert range_report["piutang_total"] > 0