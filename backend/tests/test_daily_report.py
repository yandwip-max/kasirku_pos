from datetime import datetime, timezone

import pytest

from routers.reports import daily_report


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _limit):
        return self.documents


class FakeRepo:
    def __init__(self, documents):
        self.documents = documents

    def find(self, _collection, _query):
        return FakeCursor(self.documents)


@pytest.mark.asyncio
async def test_daily_report_groups_sales_and_reflects_partial_piutang_payment():
    report = await daily_report(
        days=1,
        principal=object(),
        repo=FakeRepo(
            [
                {
                    "id": "trx-1",
                    "created_at": datetime.now(timezone.utc),
                    "total": 10000,
                    "amount_paid": 4000,
                    "payment_method": "piutang",
                    "items": [{"qty": 1, "cost": 2500, "subtotal": 10000}],
                }
            ]
        ),
    )

    assert len(report.rows) == 1
    assert report.rows[0].revenue == 10000
    assert report.rows[0].piutang_paid == 4000
    assert report.rows[0].piutang_unpaid == 6000
