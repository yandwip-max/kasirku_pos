import uuid

from tests.helpers import KASIR, PEMILIK, auth_headers


def test_voucher_data_barcode_is_unique_stocked_and_sold_once(client):
    owner = auth_headers(client, PEMILIK)
    suffix = uuid.uuid4().hex[:8]
    product_response = client.post(
        "/products",
        headers=owner,
        json={
            "name": f"Voucher Data {suffix}",
            "type": "voucher",
            "category": "Voucher Data",
            "sell_price": 25000,
            "cost_price": 20000,
            "stock_qty": 99,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product = product_response.json()
    assert product["stock_qty"] == 0
    product_id = product["id"]

    barcode = f"VD{uuid.uuid4().hex[:18].upper()}"
    unit_response = client.post(
        f"/products/{product_id}/units",
        headers=owner,
        json={"barcode": barcode, "cost_price": 19000, "sell_price": 24000},
    )
    assert unit_response.status_code == 201, unit_response.text
    unit = unit_response.json()
    assert unit["barcode"] == barcode

    duplicate = client.post(
        f"/products/{product_id}/units",
        headers=owner,
        json={"barcode": barcode, "cost_price": 19000, "sell_price": 24000},
    )
    assert duplicate.status_code == 409, duplicate.text

    scanned = client.get(f"/products/scan/{barcode}", headers=owner)
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["product"]["id"] == product_id
    assert scanned.json()["unit"]["id"] == unit["id"]

    sale = client.post(
        "/transactions",
        headers=owner,
        json={
            "items": [{"product_id": product_id, "unit_id": unit["id"], "qty": 1}],
            "payment_method": "qris",
        },
    )
    assert sale.status_code == 201, sale.text
    assert sale.json()["items"][0]["barcode"] == barcode

    products = client.get("/products?type=voucher", headers=owner)
    voucher = next(item for item in products.json() if item["id"] == product_id)
    assert voucher["stock"] == 0

    sold_scan = client.get(f"/products/scan/{barcode}", headers=owner)
    assert sold_scan.status_code == 409, sold_scan.text


def test_cashier_cannot_manage_voucher_stock_or_owner_settings(client):
    owner = auth_headers(client, PEMILIK)
    cashier = auth_headers(client, KASIR)
    suffix = uuid.uuid4().hex[:8]
    product = client.post(
        "/products",
        headers=owner,
        json={"name": f"Voucher Data Owner Only {suffix}", "type": "voucher", "sell_price": 1000},
    )
    assert product.status_code == 201, product.text

    unit = client.post(
        f"/products/{product.json()['id']}/units",
        headers=cashier,
        json={"barcode": f"VD{uuid.uuid4().hex[:18].upper()}"},
    )
    assert unit.status_code == 403, unit.text

    owner_unit = client.post(
        f"/products/{product.json()['id']}/units",
        headers=owner,
        json={"barcode": f"VD{uuid.uuid4().hex[:18].upper()}"},
    )
    assert owner_unit.status_code == 201, owner_unit.text
    hidden_codes = client.get(f"/products/{product.json()['id']}/units", headers=cashier)
    assert hidden_codes.status_code == 403, hidden_codes.text

    settings = client.patch(
        "/auth/store",
        headers=cashier,
        json={"name": "Toko Kasir", "address": "", "phone": ""},
    )
    assert settings.status_code == 403, settings.text


def test_voucher_stock_can_be_added_manually_and_sold_without_a_barcode(client):
    owner = auth_headers(client, PEMILIK)
    suffix = uuid.uuid4().hex[:8]
    product_response = client.post(
        "/products",
        headers=owner,
        json={
            "name": f"Voucher Manual {suffix}",
            "type": "voucher",
            "sell_price": 25000,
            "cost_price": 20000,
            "track_imei": True,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    stock_response = client.post(
        f"/products/{product_id}/voucher-stock",
        headers=owner,
        json={"quantity": 3},
    )
    assert stock_response.status_code == 200, stock_response.text
    assert stock_response.json()["stock_qty"] == 3

    products = client.get("/products?type=voucher", headers=owner)
    voucher = next(item for item in products.json() if item["id"] == product_id)
    assert voucher["stock"] == 3

    sale = client.post(
        "/transactions",
        headers=owner,
        json={
            "items": [{"product_id": product_id, "qty": 2}],
            "payment_method": "qris",
        },
    )
    assert sale.status_code == 201, sale.text
    assert sale.json()["items"][0]["unit_id"] is None
    assert sale.json()["items"][0]["qty"] == 2

    products = client.get("/products?type=voucher", headers=owner)
    voucher = next(item for item in products.json() if item["id"] == product_id)
    assert voucher["stock"] == 1
