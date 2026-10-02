"""One-time MongoDB to PostgreSQL/Supabase document migration.

Run from backend after DATABASE_URL and SOURCE_MONGO_URL are configured:
    python migrate_mongo.py
"""

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

from lib.postgres import Database

load_dotenv(Path(__file__).parent / ".env")

MIGRATION_ORDER = (
    "stores",
    "users",
    "products",
    "categories",
    "product_units",
    "transactions",
    "attendance",
    "daily_report_runs",
    "activity_logs",
    "email_tests",
    "cron_runs",
    "status_checks",
)


async def migrate() -> None:
    source_url = os.environ.get("SOURCE_MONGO_URL") or os.environ.get("MONGO_URL")
    source_name = os.environ.get("SOURCE_DB_NAME") or os.environ.get("DB_NAME", "kasirku_pos")
    target_url = os.environ.get("DATABASE_URL")
    if not source_url or not target_url:
        raise RuntimeError("Set SOURCE_MONGO_URL and DATABASE_URL in backend/.env before migrating.")

    source_client = MongoClient(source_url)
    target = Database(target_url)
    try:
        await target.ensure_schema()
        source = source_client[source_name]
        for collection_name in MIGRATION_ORDER:
            documents = [
                {key: value for key, value in doc.items() if key != "_id"}
                for doc in source[collection_name].find({})
            ]
            if not documents:
                print(f"{collection_name}: 0 rows")
                continue
            await target[collection_name].insert_many(documents)
            print(f"{collection_name}: {len(documents)} rows copied")
    finally:
        source_client.close()
        await target.close()


if __name__ == "__main__":
    asyncio.run(migrate())
