from datetime import date, datetime, time, timedelta, timezone
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
from models.transaction import Transaction

router = APIRouter(prefix="/reports")
WIB = ZoneInfo("Asia/Jakarta")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _item_cogs(item: dict) -> int:
    return int(item.get("cost") or 0) * item["qty"]


def _item_profit(item: dict) -> int:
    return item["subtotal"] - int(item.get("cost") or 0) * item["qty"]


@router.get("/daily/{work_date}/transactions", response_model=list[Transaction])
async def daily_transactions(
    work_date: str,
    principal: Principal = Depends(require("report:read")),
    repo: ScopedRepo = Depends(scoped_repo),
):
    """All transactions created on one store business date, including voided records."""
    try:
        day = date.fromisoformat(work_date)
    except ValueError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="Format tanggal harus YYYY-MM-DD") from exc
    start = datetime.combine(day, time.min, tzinfo=WIB).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=WIB).astimezone(timezone.utc)
    docs = await repo.find(
        "transactions", {"created_at": {"$gte": start, "$lt": end}}
    ).sort("created_at", -1).to_list(1000)
    return [
        Transaction(
            **{
                **doc,
                "created_at": _aware(doc["created_at"]),
                "due_date": _aware(doc["due_date"]) if doc.get("due_date") else None,
                "piutang_paid_at": _aware(doc["piutang_paid_at"]) if doc.get("piutang_paid_at") else None,
                "voided_at": _aware(doc["voided_at"]) if doc.get("voided_at") else None,
            }
        )
        for doc in docs
    ]


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
    piutang_paid = 0
    piutang_unpaid = 0
    daily: dict[str, dict] = {}
    payment: dict[str, dict] = {}
    products: dict[str, dict] = {}
    for doc in docs:
        created = _aware(doc["created_at"])
        total_revenue += doc["total"]
        if doc.get("payment_method") == "piutang":
            paid = min(doc["total"], max(0, int(doc.get("amount_paid") or 0)))
            piutang_paid += paid
            piutang_unpaid += doc["total"] - paid
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
        piutang_paid=piutang_paid,
        piutang_unpaid=piutang_unpaid,
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
            day, {"revenue": 0, "cogs": 0, "profit": 0, "transactions": 0, "items_sold": 0, "phones_sold": 0, "cash": 0, "qris": 0, "piutang": 0, "piutang_paid": 0, "piutang_unpaid": 0}
        )
        bucket["revenue"] += doc["total"]
        bucket["transactions"] += 1
        if doc["payment_method"] == "tunai":
            bucket["cash"] += doc["total"]
        elif doc["payment_method"] == "qris":
            bucket["qris"] += doc["total"]
        else:
            bucket["piutang"] += doc["total"]
            paid = min(doc["total"], max(0, int(doc.get("amount_paid") or 0)))
            bucket["piutang_paid"] += paid
            bucket["piutang_unpaid"] += doc["total"] - paid
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