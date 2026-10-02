"""Shared PostgreSQL handle, kept at the original import path for existing routers."""

import os
import logging
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, ReturnDocument

from lib.postgres import Client, Database

load_dotenv(Path(__file__).parent.parent / ".env")

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    raise RuntimeError(
        "DATABASE_URL belum diatur di backend/.env. Untuk PostgreSQL lokal Windows, "
        "gunakan postgresql://postgres:<password>@127.0.0.1:5432/postgres."
    )
parts = urlsplit(database_url)
if parts.hostname in {"localhost", "127.0.0.1"} and parts.port == 54322:
    userinfo = f"{parts.netloc.rsplit('@', 1)[0]}@" if "@" in parts.netloc else ""
    database_url = urlunsplit(parts._replace(netloc=f"{userinfo}{parts.hostname}:5432"))
    logging.getLogger(__name__).warning(
        "Local DATABASE_URL used Docker/Supabase port 54322; using native PostgreSQL port 5432 instead"
    )
db = Database(database_url)
client = Client(db)


async def ensure_indexes() -> None:
    await db.ensure_schema()
