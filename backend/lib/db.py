"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
# Tenant data is always filtered by store_id, so every compound index leads with it.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "stores": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        # one user belongs to exactly one store, so the login identity is globally unique
        IndexModel([("email", ASCENDING)], name="email", unique=True),
        IndexModel([("store_id", ASCENDING)], name="store_id"),
    ],
    "products": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("store_id", ASCENDING), ("type", ASCENDING)], name="store_type"),
        IndexModel([("store_id", ASCENDING), ("name", ASCENDING)], name="store_name"),
    ],
    "product_units": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        # IMEI is unique per store, not globally — two stores may each hold their own records
        IndexModel([("store_id", ASCENDING), ("imei", ASCENDING)], name="store_imei", unique=True),
        IndexModel([("store_id", ASCENDING), ("product_id", ASCENDING), ("status", ASCENDING)], name="store_product_status"),
    ],
    "transactions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("store_id", ASCENDING), ("transaction_number", ASCENDING)], name="store_trx_number", unique=True),
        IndexModel([("store_id", ASCENDING), ("created_at", DESCENDING)], name="store_created_desc"),
        # offline replay dedupe; partial (not sparse) so many rows may legitimately carry no ref at all
        IndexModel(
            [("store_id", ASCENDING), ("client_ref", ASCENDING)],
            name="store_client_ref",
            unique=True,
            partialFilterExpression={"client_ref": {"$type": "string"}},
        ),
    ],
}

# Single-tenant indexes from before multi-store support; they now block legitimate writes
# (e.g. two stores reusing an IMEI or the same daily transaction number).
LEGACY_INDEXES: dict[str, list[str]] = {
    "product_units": ["imei"],
    "transactions": ["transaction_number", "store_client_ref"],
    "products": ["type", "name"],
}


async def ensure_indexes() -> None:
    for collection, names in LEGACY_INDEXES.items():
        for name in names:
            try:
                await db[collection].drop_index(name)
                logger.info("dropped legacy index %s.%s", collection, name)
            except Exception:
                pass  # absent on a fresh database — nothing to migrate

    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)