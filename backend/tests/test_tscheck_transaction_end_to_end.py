"""Transaction end-to-end: handphone IMEI sale + item discount, and cash-shortfall rejection.

Criterion: "Transaksi kasir end-to-end (tunai & QRIS) termasuk handphone ber-IMEI dan diskon
per item" + "Validasi pembayaran tunai kurang dari total".
"""
import uuid

import httpx

from tests.helpers import PEMILIK, auth_headers


def _create_handphone_with_unit(client: httpx.Client, headers: dict) -> tuple[str, str, int]:
    name = f"tscheck-trx-phone-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/products",
        headers=headers,
        json={
            "type": "handphone",
            "name": name,
            "cost_price": 1000000,
            "sell_price": 1500000,
        },
    )
    assert r.status_code == 201, r.text
    product_id = r.json()["id"]

    imei = f"TS{uuid.uuid4().hex[:12]}"
    r = client.post(
        f"/products/{product_id}/units",
        headers=headers,
        json={"imei": imei, "color": "Hitam", "capacity": "128GB", "cost_price": 1000000, "sell_price": 1500000},
    )
    assert r.status_code == 201, r.text
    unit_id = r.json()["id"]
    return product_id, unit_id, 1500000


def test_transaction_with_imei_and_discount_succeeds_and_decrements_stock():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_handphone_with_unit(client, headers)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [
                    {
                        "product_id": product_id,
                        "unit_id": unit_id,
                        "qty": 1,
                        "discount_type": "nominal",
                        "discount_value": 50000,
                    }
                ],
                "payment_method": "tunai",
                "amount_paid": sell_price - 50000,
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["items"][0]["discount"] == 50000
        assert body["total"] == sell_price - 50000
        assert body["change_amount"] == 0

        # Stock: unit should now be sold, not resellable.
        r2 = client.get(f"/products/{product_id}/units", headers=headers)
        assert r2.status_code == 200
        sold_unit = next(u for u in r2.json() if u["id"] == unit_id)
        assert sold_unit["status"] == "sold"


def test_transaction_qris_payment_succeeds():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_handphone_with_unit(client, headers)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "qris",
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 201, r.text
        assert r.json()["payment_method"] == "qris"
        assert r.json()["total"] == sell_price


def test_cash_payment_below_total_is_rejected_and_stock_untouched():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        product_id, unit_id, sell_price = _create_handphone_with_unit(client, headers)

        r = client.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product_id, "unit_id": unit_id, "qty": 1}],
                "payment_method": "tunai",
                "amount_paid": sell_price - 100000,
                "customer_name": "",
                "customer_phone": "",
            },
        )
        assert r.status_code == 400, r.text
        assert "kurang" in r.json()["detail"].lower()

        r2 = client.get(f"/products/{product_id}/units", headers=headers)
        unit = next(u for u in r2.json() if u["id"] == unit_id)
        assert unit["status"] == "in_stock", "stock must NOT be decremented on a rejected payment"
