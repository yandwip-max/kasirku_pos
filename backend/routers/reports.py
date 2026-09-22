from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter

from lib.db import db
from models.report import DailyPoint, PaymentPoint, ReportSummary, TopProduct

router = APIRouter(prefix="/reports")
WIB = ZoneInfo("Asia/Jakarta")


@router.get("/summary", response_model=ReportSummary)
async def report_summary(days: int = 30):
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    docs = await db.transactions.find({"created_at": {"$gte": now - timedelta(days=days)}}).to_list(10000)

    total_revenue = 0
    phones_sold = 0
    daily: dict[str, dict] = {}
    payment: dict[str, dict] = {}
    products: dict[str, dict] = {}
    for doc in docs:
        created = doc["created_at"]
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        total_revenue += doc["total"]
        for item in doc["items"]:
            if item.get("unit_id"):
                phones_sold += item["qty"]
            entry = products.setdefault(item["product_name"], {"qty": 0, "revenue": 0})
            entry["qty"] += item["qty"]
            entry["revenue"] += item["subtotal"]
        day = created.astimezone(WIB).strftime("%Y-%m-%d")
        bucket = daily.setdefault(day, {"revenue": 0, "transactions": 0})
        bucket["revenue"] += doc["total"]
        bucket["transactions"] += 1
        pay = payment.setdefault(doc["payment_method"], {"count": 0, "revenue": 0})
        pay["count"] += 1
        pay["revenue"] += doc["total"]

    today_wib = now.astimezone(WIB).date()
    daily_series = []
    for offset in range(days - 1, -1, -1):
        day = (today_wib - timedelta(days=offset)).strftime("%Y-%m-%d")
        bucket = daily.get(day, {"revenue": 0, "transactions": 0})
        daily_series.append(DailyPoint(date=day, revenue=bucket["revenue"], transactions=bucket["transactions"]))

    top = sorted(products.items(), key=lambda kv: kv[1]["revenue"], reverse=True)[:5]
    return ReportSummary(
        days=days,
        total_revenue=total_revenue,
        transaction_count=len(docs),
        phones_sold=phones_sold,
        avg_transaction=total_revenue // len(docs) if docs else 0,
        daily=daily_series,
        payment_breakdown=[PaymentPoint(method=method, **values) for method, values in payment.items()],
        top_products=[TopProduct(name=name, **values) for name, values in top],
    )