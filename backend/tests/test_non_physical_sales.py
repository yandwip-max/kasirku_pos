import pytest
from fastapi import HTTPException

from lib.auth import Principal
from models.product import ProductCreate
from models.transaction import CartItemIn, CheckoutIn
from routers.products import create_product
from routers.transactions import create_transaction


class FakeRepo:
    def __init__(self, product):
        self.product = product
        self.updates = []
        self.transaction = None

    async def find_one(self, collection, query):
        if collection == "products" and query.get("id") == self.product["id"]:
            return self.product
        return None

    async def count_documents(self, _collection, _query):
        return 0

    async def update_one(self, collection, query, update):
        self.updates.append((collection, query, update))
        return type("UpdateResult", (), {"matched_count": 1})()

    async def insert_one(self, collection, doc):
        if collection == "transactions":
            self.transaction = dict(doc)
        return None


class FakeProductRepo:
    def __init__(self):
        self.created = None

    async def find_one(self, _collection, _query):
        return None

    async def insert_one(self, _collection, doc):
        self.created = dict(doc)


@pytest.mark.asyncio
async def test_non_physical_checkout_records_target_without_stock_mutation():
    product = {
        "id": "service-pulsa-1",
        "store_id": "store-1",
        "name": "Pulsa Telkomsel 10K",
        "type": "non_fisik",
        "service_category": "pulsa",
        "provider": "Telkomsel",
        "denomination": 10000,
        "stock_qty": 0,
        "sell_price": 11000,
        "cost_price": 10000,
        "track_imei": False,
    }
    repo = FakeRepo(product)
    principal = Principal(
        user_id="owner-1",
        store_id="store-1",
        role="pemilik",
        name="Pemilik",
        email="owner@example.test",
        store_name="Toko",
    )
    payload = CheckoutIn(
        items=[CartItemIn(product_id=product["id"], service_target="081234567890")],
        payment_method="qris",
    )

    result = await create_transaction.__wrapped__(payload, principal, repo)

    assert repo.updates == []
    assert repo.transaction["items"][0]["service_target"] == "081234567890"
    assert repo.transaction["items"][0]["service_amount"] == 10000
    assert repo.transaction["items"][0]["price"] == 11000
    assert result.items[0].provider == "Telkomsel"


@pytest.mark.asyncio
async def test_non_physical_product_saves_without_physical_stock(monkeypatch):
    async def no_op_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr("routers.products.log_activity", no_op_log)
    repo = FakeProductRepo()
    principal = Principal(
        user_id="owner-1",
        store_id="store-1",
        role="pemilik",
        name="Pemilik",
        email="owner@example.test",
        store_name="Toko",
    )
    payload = ProductCreate(
        name="Token PLN 250K",
        type="non_fisik",
        service_category="pln",
        provider="PLN",
        denomination=250000,
        stock_qty=12,
        track_imei=True,
    )

    product = await create_product.__wrapped__(payload, principal, repo)

    assert product.type == "non_fisik"
    assert product.stock_qty == 0
    assert product.track_imei is False
    assert repo.created["denomination"] == 250000


@pytest.mark.asyncio
async def test_non_physical_product_rejects_unsupported_pulsa_denomination(monkeypatch):
    async def no_op_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr("routers.products.log_activity", no_op_log)
    principal = Principal(
        user_id="owner-1",
        store_id="store-1",
        role="pemilik",
        name="Pemilik",
        email="owner@example.test",
        store_name="Toko",
    )
    payload = ProductCreate(
        name="Pulsa tidak valid",
        type="non_fisik",
        service_category="pulsa",
        provider="Telkomsel",
        denomination=12345,
    )

    with pytest.raises(HTTPException) as error:
        await create_product.__wrapped__(payload, principal, FakeProductRepo())

    assert error.value.status_code == 422
