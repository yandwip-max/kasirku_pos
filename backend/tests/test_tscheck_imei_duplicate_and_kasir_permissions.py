"""Duplicate IMEI rejected 409; kasir cannot see cost_price and is 403'd for reports/users/activity.

Criterion: "CRUD produk & stok ... IMEI duplikat ditolak 409" and
"Kasir memang tidak melihat harga modal ... ditolak 403 untuk laporan, pengguna, aktivitas, dan stok".
"""
import uuid

import httpx

from tests.helpers import KASIR, PEMILIK, auth_headers


def test_duplicate_imei_rejected_409():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        headers = auth_headers(client, PEMILIK)
        name = f"tscheck-dup-imei-{uuid.uuid4().hex[:8]}"
        r = client.post(
            "/products",
            headers=headers,
            json={"type": "handphone", "name": name, "cost_price": 1000000, "sell_price": 1500000},
        )
        assert r.status_code == 201, r.text
        product_id = r.json()["id"]

        imei = f"TSDUP{uuid.uuid4().hex[:10]}"
        r1 = client.post(
            f"/products/{product_id}/units",
            headers=headers,
            json={"imei": imei, "color": "Putih", "capacity": "64GB", "cost_price": 900000, "sell_price": 1400000},
        )
        assert r1.status_code == 201, r1.text

        r2 = client.post(
            f"/products/{product_id}/units",
            headers=headers,
            json={"imei": imei, "color": "Putih", "capacity": "64GB", "cost_price": 900000, "sell_price": 1400000},
        )
        assert r2.status_code == 409, r2.text
        assert "sudah terdaftar" in r2.json()["detail"]


def test_kasir_does_not_see_cost_price_and_is_forbidden_from_reports_users_activity():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as client:
        pemilik_headers = auth_headers(client, PEMILIK)
        name = f"tscheck-kasir-cost-{uuid.uuid4().hex[:8]}"
        r = client.post(
            "/products",
            headers=pemilik_headers,
            json={"type": "aksesoris", "name": name, "cost_price": 20000, "sell_price": 35000, "stock_qty": 10},
        )
        assert r.status_code == 201, r.text

        kasir_headers = auth_headers(client, KASIR)
        r_list = client.get("/products", headers=kasir_headers)
        assert r_list.status_code == 200
        product = next(p for p in r_list.json() if p["name"] == name)
        assert product.get("cost_price") is None, "kasir must not see cost_price"

        assert client.get("/reports/summary", headers=kasir_headers).status_code == 403
        assert client.get("/auth/users", headers=kasir_headers).status_code == 403
        assert client.get("/activity", headers=kasir_headers).status_code == 403
