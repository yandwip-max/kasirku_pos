"""Seed data for KasirKu POS. Run: cd /app/backend && python seed.py

Creates ONE demo store with a Pemilik + Kasir account and fills it with catalogue and
sales history. Stores registered through /api/auth/register start empty and never see
this data — isolation is by `store_id`.
"""

import math
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from lib.auth import hash_password
from lib.db import client, db, ensure_indexes

WIB = ZoneInfo("Asia/Jakarta")
NOW = datetime.now(timezone.utc)
random.seed(42)

DEMO_STORE_NAME = "KasirKu Cell & Accessories (Toko Demo)"
DEMO_PASSWORD = "demo1234"
DEMO_OWNER_EMAIL = "pemilik@demo.id"
DEMO_CASHIER_EMAIL = "kasir@demo.id"


def uid() -> str:
    return str(uuid.uuid4())


PHONES = [
    {
        "name": "iPhone 15 Pro",
        "brand": "Apple",
        "sku": "HP-IP15P",
        "cost_price": 11500000,
        "sell_price": 13499000,
        "variants": [("Midnight Black", "256GB", 2), ("Natural Titanium", "256GB", 1), ("Blue Titanium", "512GB", 1)],
    },
    {
        "name": "Samsung Galaxy S24",
        "brand": "Samsung",
        "sku": "HP-SGS24",
        "cost_price": 9200000,
        "sell_price": 10999000,
        "variants": [("Onyx Black", "128GB", 2), ("Amber Yellow", "256GB", 1), ("Marble Grey", "256GB", 1)],
    },
    {
        "name": "Xiaomi Redmi Note 13",
        "brand": "Xiaomi",
        "sku": "HP-RN13",
        "cost_price": 2350000,
        "sell_price": 2799000,
        "variants": [("Graphite Gray", "256GB", 3), ("Midnight Black", "128GB", 2)],
    },
    {
        "name": "Oppo Reno 11 F",
        "brand": "Oppo",
        "sku": "HP-RENO11F",
        "cost_price": 3600000,
        "sell_price": 4299000,
        "variants": [("Ocean Blue", "256GB", 2), ("Palm Green", "256GB", 2)],
    },
]

ACCESSORIES = [
    ("Anker PowerPort 20W Fast Charger", "Anker", "AK-ANK20", "Charger & Kabel", 135000, 189000, 14),
    ("Kabel USB-C to C 2M Original", "Samsung", "AK-KBL2M", "Charger & Kabel", 55000, 99000, 22),
    ("Powerbank Anker 10000mAh 22.5W", "Anker", "AK-PB10K", "Charger & Kabel", 240000, 329000, 7),
    ("Spigen Liquid Air Case iPhone 15 Pro", "Spigen", "AK-CS15P", "Aksesoris & Casing", 165000, 249000, 9),
    ("Softcase Silicon Clear Universal", "Nillkin", "AK-CSCLR", "Aksesoris & Casing", 25000, 49000, 40),
    ("Tempered Glass Anti Gores 9H", "QCF", "AK-GLS9H", "Aksesoris & Casing", 12000, 35000, 60),
    ("Soundcore TWS Earbuds Pro ANC", "Soundcore", "AK-TWSP", "Audio / TWS", 320000, 459000, 11),
    ("Sandisk MicroSD 128GB 120MB/s", "Sandisk", "AK-SD128", "Aksesoris & Casing", 110000, 165000, 17),
]

# Voucher data are stocked as individually scanned codes.
VOUCHERS = [
    ("Voucher Data Telkomsel 10GB / 30 Hari", "Telkomsel", "VC-D10GB", 50000, 60000, 55000, 99),
    ("Voucher Data Telkomsel 25GB / 30 Hari", "Telkomsel", "VC-TSEL25", 90000, 105000, 98000, 80),
    ("Voucher Data Telkomsel 50GB / 30 Hari", "Telkomsel", "VC-TSEL50", 145000, 165000, 155000, 60),
    ("Voucher Data Indosat 25GB / 30 Hari", "Indosat", "VC-ISAT25", 85000, 99000, 92000, 50),
    ("Voucher Data XL 5GB / 30 Hari", "XL Axiata", "VC-XL5GB", 42000, 52000, 47000, 35),
]

CUSTOMERS = ["", "", "Budi Santoso", "Sari Wulandari", "Andi Pratama", "Rina Maulida", "Joko Susilo"]


@db.transactional
async def seed() -> None:
    if await db.stores.find_one({"name": DEMO_STORE_NAME}):
        print("Seed skipped: demo store already exists.")
        return

    store_id = uid()
    await db.stores.insert_one(
        {
            "id": store_id,
            "name": DEMO_STORE_NAME,
            "address": "Jl. Merdeka Raya No. 12, Jakarta Pusat",
            "phone": "0812-3456-7890",
            "created_at": NOW - timedelta(days=14),
        }
    )
    owner_hash = hash_password(DEMO_PASSWORD)
    await db.users.insert_many(
        [
            {
                "id": uid(),
                "store_id": store_id,
                "name": "Pak Pemilik",
                "email": DEMO_OWNER_EMAIL,
                "password_hash": owner_hash,
                "role": "pemilik",
                "is_active": True,
                "created_at": NOW - timedelta(days=14),
            },
            {
                "id": uid(),
                "store_id": store_id,
                "name": "Kasir Pagi",
                "email": DEMO_CASHIER_EMAIL,
                "password_hash": owner_hash,
                "role": "kasir",
                "is_active": True,
                "created_at": NOW - timedelta(days=13),
            },
        ]
    )

    products_docs: dict[str, dict] = {}
    product_ids: list[str] = []
    for p in PHONES:
        doc = {
            "id": uid(),
            "store_id": store_id,
            "name": p["name"],
            "brand": p["brand"],
            "type": "handphone",
            "category": "Handphone",
            "sku": p["sku"],
            "cost_price": p["cost_price"],
            "sell_price": p["sell_price"],
            "wholesale_price": 0,
            "stock_qty": 0,
            "min_stock": 2,
            "is_active": True,
            "created_at": NOW,
        }
        await db.products.insert_one(dict(doc))
        products_docs[doc["id"]] = doc
        product_ids.append(doc["id"])

    acc_docs: list[dict] = []
    for name, brand, sku, cat, cost, sell, qty in ACCESSORIES:
        doc = {
            "id": uid(),
            "store_id": store_id,
            "name": name,
            "brand": brand,
            "type": "aksesoris",
            "category": cat,
            "sku": sku,
            "cost_price": cost,
            "sell_price": sell,
            "wholesale_price": 0,
            "stock_qty": qty,
            "min_stock": 5,
            "is_active": True,
            "created_at": NOW,
        }
        await db.products.insert_one(dict(doc))
        products_docs[doc["id"]] = doc
        acc_docs.append(doc)

    for name, brand, sku, cost, sell, wholesale, qty in VOUCHERS:
        doc = {
            "id": uid(),
            "store_id": store_id,
            "name": name,
            "brand": brand,
            "type": "voucher",
            "category": "Voucher Data",
            "sku": sku,
            "cost_price": cost,
            "sell_price": sell,  # harga ritel
            "wholesale_price": wholesale,  # harga grosir
            "stock_qty": 0,
            "min_stock": 10,
            "is_active": True,
            "created_at": NOW,
        }
        await db.products.insert_one(dict(doc))
        products_docs[doc["id"]] = doc
        acc_docs.append({**doc, "stock_qty": qty})  # simulated historic sales before per-code stock

    # Serialized handphone units (15-digit IMEI per physical unit)
    units_by_product: dict[str, list[dict]] = {}
    imei_counter = 354912000000000
    for pid, p in zip(product_ids, PHONES):
        units = []
        for color, capacity, n in p["variants"]:
            for _ in range(n):
                imei_counter += 7
                units.append(
                    {
                        "id": uid(),
                        "store_id": store_id,
                        "product_id": pid,
                        "imei": str(imei_counter),
                        "color": color,
                        "capacity": capacity,
                        "cost_price": p["cost_price"],
                        "sell_price": p["sell_price"],
                        "status": "in_stock",
                        "created_at": NOW - timedelta(days=3),
                        "sold_at": None,
                        "transaction_id": None,
                    }
                )
        await db.product_units.insert_many([dict(u) for u in units])
        units_by_product[pid] = units

    # Historical transactions across the past 12 days (WIB business days)
    txs: list[dict] = []
    day_counts: dict[str, int] = {}
    sold_acc_qty: dict[str, int] = {}
    for days_ago in range(11, -1, -1):
        day = (NOW.astimezone(WIB) - timedelta(days=days_ago)).date()
        for _ in range(random.choice([1, 2, 2, 3])):
            key = day.strftime("%Y%m%d")
            day_counts[key] = day_counts.get(key, 0) + 1
            created = datetime(day.year, day.month, day.day, random.randint(9, 20), random.randint(0, 59), tzinfo=WIB).astimezone(timezone.utc)
            if created > NOW:
                created = NOW
            trx_id = uid()
            items = []
            available_accs = [a for a in acc_docs if a["stock_qty"] - sold_acc_qty.get(a["id"], 0) > 0]
            if available_accs:
                for acc in random.sample(available_accs, k=min(random.choice([1, 1, 2, 3]), len(available_accs))):
                    # never oversell: cap the line at the remaining stock
                    remaining = acc["stock_qty"] - sold_acc_qty.get(acc["id"], 0)
                    qty = min(random.choice([1, 1, 2]), remaining)
                    items.append(
                        {
                            "product_id": acc["id"],
                            "product_name": acc["name"],
                            "unit_id": None,
                            "imei": None,
                            "color": None,
                            "capacity": None,
                            "qty": qty,
                            "price": acc["sell_price"],
                            "price_tier": "ritel",
                            "cost": acc["cost_price"],
                            "discount_type": None,
                            "discount_value": 0,
                            "discount": 0,
                            "subtotal": acc["sell_price"] * qty,
                        }
                    )
                    sold_acc_qty[acc["id"]] = sold_acc_qty.get(acc["id"], 0) + qty
            if random.random() < 0.45:
                pid = random.choice(product_ids)
                available = [u for u in units_by_product[pid] if u["status"] == "in_stock"]
                if available:
                    unit = random.choice(available)
                    product = products_docs[pid]
                    unit["status"] = "sold"
                    unit["sold_at"] = created
                    unit["transaction_id"] = trx_id
                    items.append(
                        {
                            "product_id": pid,
                            "product_name": product["name"],
                            "unit_id": unit["id"],
                            "imei": unit["imei"],
                            "color": unit["color"],
                            "capacity": unit["capacity"],
                            "qty": 1,
                            "price": product["sell_price"],
                            "price_tier": "ritel",
                            "cost": product["cost_price"],
                            "discount_type": None,
                            "discount_value": 0,
                            "discount": 0,
                            "subtotal": product["sell_price"],
                        }
                    )
            if not items:
                continue
            total = sum(i["subtotal"] for i in items)
            profit = sum(i["subtotal"] - i["cost"] * i["qty"] for i in items)
            payment_method = random.choice(["tunai", "tunai", "qris"])
            paid = math.ceil(total / 50000) * 50000 if payment_method == "tunai" else total
            txs.append(
                {
                    "id": trx_id,
                    "store_id": store_id,
                    "transaction_number": f"TRX-{key}-{day_counts[key]:04d}",
                    "items": items,
                    "gross_total": total,
                    "discount_total": 0,
                    "total": total,
                    "profit": profit,
                    "payment_method": payment_method,
                    "amount_paid": paid,
                    "change_amount": paid - total,
                    "customer_name": random.choice(CUSTOMERS),
                    "customer_phone": "",
                    "cashier_name": "Kasir Pagi",
                    "created_at": created,
                }
            )

    if txs:
        await db.transactions.insert_many([dict(t) for t in txs])

    for voucher in (product for product in acc_docs if product["type"] == "voucher"):
        remaining = max(0, voucher["stock_qty"] - sold_acc_qty.get(voucher["id"], 0))
        units = []
        for index in range(1, remaining + 1):
            barcode = f"VD-{voucher['sku']}-{index:06d}"
            units.append({
                "id": uid(),
                "store_id": store_id,
                "product_id": voucher["id"],
                "imei": barcode,
                "barcode": barcode,
                "color": "",
                "capacity": "",
                "cost_price": voucher["cost_price"],
                "sell_price": voucher["sell_price"],
                "status": "in_stock",
                "created_at": NOW - timedelta(days=3),
                "sold_at": None,
                "transaction_id": None,
            })
        if units:
            await db.product_units.insert_many(units)

    for units in units_by_product.values():
        for unit in units:
            if unit["status"] == "sold":
                await db.product_units.update_one(
                    {"id": unit["id"]},
                    {"$set": {"status": "sold", "sold_at": unit["sold_at"], "transaction_id": unit["transaction_id"]}},
                )

    for acc in acc_docs:
        if acc["type"] == "voucher":
            continue
        sold = sold_acc_qty.get(acc["id"], 0)
        if sold:
            await db.products.update_one({"id": acc["id"]}, {"$inc": {"stock_qty": -sold}})

    print(f"Seeded demo store: {len(product_ids)} handphone, {len(ACCESSORIES)} aksesoris, {len(VOUCHERS)} voucher data, {len(txs)} transaksi.")
    print(f"  Pemilik: {DEMO_OWNER_EMAIL} / {DEMO_PASSWORD}")
    print(f"  Kasir  : {DEMO_CASHIER_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    if os.environ.get("VERCEL") == "1":
        raise SystemExit("Demo data seeding is disabled on Vercel.")

    import asyncio

    async def main() -> None:
        try:
            await ensure_indexes()
            await seed()
        finally:
            await client.close()

    asyncio.run(main())