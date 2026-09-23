from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from lib.auth import Principal, require
from lib.scoped import ScopedRepo, scoped_repo
from models.report import (
    DailyPoint,
    DailyReport,
    DailyRow,
    PaymentPoint,
    ReportSummary,
    TopProduct,
)

router = APIRouter(prefix="/reports")
WIB = ZoneInfo("Asia/Jakarta")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _item_cogs(item: dict) -> int:
    return int(item.get("cost") or 0) * item["qty"]


def _item_profit(item: dict) -> int:
    return item["subtotal"] - int(item.get("cost") or 0) * item["qty"]


@router.get("/summary", response_model=ReportSummary)
async def report_summary(
    days: int = 30,
    principal: Principal = Depends(require("report:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    docs = await repo.find(
        "transactions", {"created_at": {"$gte": now - timedelta(days=days)}, "status": {"$ne": "void"}}
    ).to_list(10000)

    total_revenue = 0
    total_cogs = 0
    total_profit = 0
    phones_sold = 0
    daily: dict[str, dict] = {}
    payment: dict[str, dict] = {}
    products: dict[str, dict] = {}
    for doc in docs:
        created = _aware(doc["created_at"])
        total_revenue += doc["total"]
        for item in doc["items"]:
            profit = _item_profit(item)
            total_profit += profit
            total_cogs += _item_cogs(item)
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
        total_cogs=total_cogs,
        total_profit=total_profit,
        transaction_count=len(docs),
        phones_sold=phones_sold,
        avg_transaction=total_revenue // len(docs) if docs else 0,
        daily=daily_series,
        payment_breakdown=[PaymentPoint(method=method, **values) for method, values in payment.items()],
        top_products=[TopProduct(name=name, **values) for name, values in top],
    )


@router.get("/daily", response_model=DailyReport)
async def daily_report(
    days: int = 30,
    principal: Principal = Depends(require("report:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """Per-day sales + profit, newest first. Profit uses the harga modal snapshot stored
    on each transaction item, so later price edits never rewrite past days."""
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    docs = await repo.find(
        "transactions", {"created_at": {"$gte": now - timedelta(days=days)}, "status": {"$ne": "void"}}
    ).to_list(10000)

    buckets: dict[str, dict] = {}
    for doc in docs:
        day = _aware(doc["created_at"]).astimezone(WIB).strftime("%Y-%m-%d")
        bucket = buckets.setdefault(
            day, {"revenue": 0, "cogs": 0, "profit": 0, "transactions": 0, "items_sold": 0, "phones_sold": 0, "cash": 0, "qris": 0}
        )
        bucket["revenue"] += doc["total"]
        bucket["transactions"] += 1
        bucket["cash" if doc["payment_method"] == "tunai" else "qris"] += doc["total"]
        for item in doc["items"]:
            bucket["profit"] += _item_profit(item)
            bucket["cogs"] += _item_cogs(item)
            bucket["items_sold"] += item["qty"]
            if item.get("unit_id"):
                bucket["phones_sold"] += item["qty"]

    today_wib = now.astimezone(WIB).date()
    rows: list[DailyRow] = []
    for offset in range(days):
        day = (today_wib - timedelta(days=offset)).strftime("%Y-%m-%d")
        bucket = buckets.get(day)
        if not bucket:
            continue  # only days with sales appear in the table
        margin = round(bucket["profit"] / bucket["revenue"] * 100, 1) if bucket["revenue"] else 0.0
        rows.append(DailyRow(date=day, margin_percent=margin, **bucket))

    return DailyReport(
        days=days,
        rows=rows,
        total_revenue=sum(r.revenue for r in rows),
        total_cogs=sum(r.cogs for r in rows),
        total_profit=sum(r.profit for r in rows),
        total_transactions=sum(r.transactions for r in rows),
        best_day=max(rows, key=lambda r: r.revenue).date if rows else None,
    )