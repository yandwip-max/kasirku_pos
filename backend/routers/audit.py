import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pymongo import DESCENDING
from lib.auth import Principal, require
from lib.db import db
from lib.dates import today_iso
from models.audit import ActivityLogOut, ActivityPage

router = APIRouter(prefix="/activity")

PERIOD_DAYS = {"today": 0, "7d": 7, "30d": 30}


@router.get("", response_model=ActivityPage)
async def list_activity(
    period: str = "30d",
    category: str = "",
    q: str = "",
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    principal: Principal = Depends(require("user:manage")),
):
    """Owner-only activity trail for this store, newest first."""
    query: dict = {"store_id": principal.store_id}

    if period in PERIOD_DAYS:
        # "today" is anchored to the shop's timezone on the server, never the browser
        zone = ZoneInfo(os.environ.get("APP_TZ", "UTC"))
        midnight = datetime.fromisoformat(f"{today_iso()}T00:00:00").replace(tzinfo=zone)
        start = midnight - timedelta(days=PERIOD_DAYS[period])
        query["at"] = {"$gte": start.astimezone(timezone.utc)}

    if category in ("harga", "stok", "produk", "akun", "toko"):
        query["category"] = category

    term = q.strip()
    if term:
        escaped = re.escape(term)
        query["$or"] = [
            {"entity_name": {"$regex": escaped, "$options": "i"}},
            {"actor_name": {"$regex": escaped, "$options": "i"}},
            {"summary": {"$regex": escaped, "$options": "i"}},
        ]

    total = await db.activity_logs.count_documents(query)
    docs = (
        await db.activity_logs.find(query).sort([("at", DESCENDING)]).skip(skip).limit(limit).to_list(limit)
    )
    rows = [ActivityLogOut(**doc) for doc in docs]
    next_skip: Optional[int] = skip + len(rows) if skip + len(rows) < total else None
    return ActivityPage(rows=rows, total=total, has_more=next_skip is not None, next_skip=next_skip)
