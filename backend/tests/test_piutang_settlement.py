import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from lib.db import db


@pytest.mark.asyncio
async def test_owner_can_fully_settle_piutang_via_api(aclient):
    suffix = uuid.uuid4().hex[:10]
    registration = await aclient.post(
        "/auth/register",
        json={
            "store_name": f"Settle QA {suffix}",
            "name": "Owner QA",
            "email": f"settle-{suffix}@example.com",
            "password": "testpass123",
        },
    )
    assert registration.status_code == 201, registration.text
    session = registration.json()
    headers = {"Authorization": f"Bearer {session['token']}"}
    store_id = session["store"]["id"]

    try:
        product_response = await aclient.post(
            "/products",
            headers=headers,
            json={
                "name": f"Barang Piutang {suffix}",
                "type": "aksesoris",
                "sell_price": 99000,
                "cost_price": 50000,
                "stock_qty": 2,
            },
        )
        assert product_response.status_code == 201, product_response.text
        product = product_response.json()

        sale = await aclient.post(
            "/transactions",
            headers=headers,
            json={
                "items": [{"product_id": product["id"], "qty": 1}],
                "payment_method": "piutang",
                "amount_paid": 0,
                "customer_name": "Pelanggan QA",
            },
        )
        assert sale.status_code == 201, sale.text
        transaction = sale.json()
        assert transaction["piutang_status"] == "unpaid"

        settled = await aclient.post(
            f"/transactions/{transaction['id']}/settle",
            headers=headers,
            json={"amount": transaction["total"]},
        )
        assert settled.status_code == 200, settled.text
        assert settled.json()["piutang_status"] == "paid"
        assert settled.json()["amount_paid"] == transaction["total"]
        assert settled.json()["piutang_paid_at"] is not None

        work_date = datetime.fromisoformat(transaction["created_at"]).astimezone(ZoneInfo("Asia/Jakarta")).date().isoformat()
        daily_detail = await aclient.get(f"/reports/daily/{work_date}/transactions", headers=headers)
        assert daily_detail.status_code == 200, daily_detail.text
        daily_transaction = next(row for row in daily_detail.json() if row["id"] == transaction["id"])
        assert daily_transaction["piutang_paid_at"] == settled.json()["piutang_paid_at"]
    finally:
        await db.stores.delete_one({"id": store_id})
