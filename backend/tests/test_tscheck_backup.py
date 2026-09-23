"""Backup data (JSON snapshot + CSV exports): store-scoped, owner-only, counts consistent."""
import csv
import io
import json
import uuid

import httpx

from tests.helpers import KASIR, PEMILIK, auth_headers


def _create_fixture_product(client: httpx.Client, headers: dict) -> str:
    suffix = uuid.uuid4().hex[:8]
    product = client.post(
        "/products",
        json={
            "name": f"tscheck-backup-prod-{suffix}",
            "type": "aksesoris",
            "category": "Aksesoris",
            "sell_price": 12000,
            "cost_price": 8000,
            "stock_qty": 5,
            "min_stock": 1,
        },
        headers=headers,
    )
    assert product.status_code == 201, product.text
    return product.json()["id"]


def test_backup_json_export_contains_counts_and_own_store_data_only(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    product_id = _create_fixture_product(client, headers)

    resp = client.get("/backup/export", headers=headers)
    assert resp.status_code == 200, resp.text
    assert "attachment" in resp.headers.get("content-disposition", "")
    assert resp.headers.get("content-disposition", "").endswith('.json"')

    snapshot = json.loads(resp.text)
    assert snapshot["app"] == "KasirKu"
    assert "counts" in snapshot
    for key in ("products", "product_units", "transactions", "activity_logs"):
        assert key in snapshot["data"]
        assert snapshot["counts"][key] == len(snapshot["data"][key])

    # the fixture product we just created must appear, and every product row must belong
    # to the logged-in store (no leaked store_id from another tenant)
    product_ids = [p["id"] for p in snapshot["data"]["products"]]
    assert product_id in product_ids
    store_ids = {p.get("store_id") for p in snapshot["data"]["products"] if "store_id" in p}
    assert store_ids in (set(), {snapshot["store_id"]})


def test_backup_csv_products_readable_with_semicolon_delimiter_and_header(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)
    product_id = _create_fixture_product(client, headers)

    resp = client.get("/backup/csv/products", headers=headers)
    assert resp.status_code == 200, resp.text
    assert "text/csv" in resp.headers.get("content-type", "")
    assert resp.headers.get("content-disposition", "").endswith('.csv"')

    text = resp.text.lstrip("\ufeff")
    reader = csv.reader(io.StringIO(text), delimiter=";")
    rows = list(reader)
    header = rows[0]
    assert header == [
        "id", "name", "type", "category", "brand", "sku", "cost_price",
        "sell_price", "wholesale_price", "stock_qty", "min_stock",
    ]
    ids = [r[0] for r in rows[1:]]
    assert product_id in ids


def test_backup_unknown_dataset_404_and_kasir_forbidden_403(client: httpx.Client):
    headers = auth_headers(client, PEMILIK)

    unknown = client.get("/backup/csv/not-a-real-dataset", headers=headers)
    assert unknown.status_code == 404, unknown.text

    kasir_headers = auth_headers(client, KASIR)
    forbidden_json = client.get("/backup/export", headers=kasir_headers)
    assert forbidden_json.status_code == 403, forbidden_json.text

    forbidden_csv = client.get("/backup/csv/products", headers=kasir_headers)
    assert forbidden_csv.status_code == 403, forbidden_csv.text
