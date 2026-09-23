"""Weekly backup/recap email, driven by the platform cron in .emergent/crons.yml.

Every store's Pemilik accounts get their own store's numbers — never another
tenant's. The cron endpoint only authenticates and hands the work off.
"""

import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from lib.db import db
from lib.email import EMAIL_FROM_NAME, send_email

router = APIRouter(prefix="/cron")
logger = logging.getLogger(__name__)
WIB = ZoneInfo("Asia/Jakarta")


def _rupiah(value: int) -> str:
    return "Rp " + f"{int(value):,}".replace(",", ".")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def _store_recap(store_id: str, days: int = 7) -> dict:
    """Last 7 days for one store: omzet, HPP, laba, transaksi, produk terlaris."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    docs = await db.transactions.find(
        {"store_id": store_id, "created_at": {"$gte": since}, "status": {"$ne": "void"}}
    ).to_list(10000)

    revenue = cogs = phones = items = 0
    products: dict[str, int] = {}
    for doc in docs:
        revenue += doc["total"]
        for item in doc["items"]:
            cogs += int(item.get("cost") or 0) * item["qty"]
            items += item["qty"]
            if item.get("unit_id"):
                phones += item["qty"]
            products[item["product_name"]] = products.get(item["product_name"], 0) + item["qty"]

    voided = await db.transactions.count_documents(
        {"store_id": store_id, "voided_at": {"$gte": since}, "status": "void"}
    )
    low_stock = await db.products.count_documents(
        {"store_id": store_id, "type": {"$in": ["aksesoris", "voucher"]}, "$expr": {"$lte": ["$stock_qty", "$min_stock"]}}
    )
    top = sorted(products.items(), key=lambda kv: kv[1], reverse=True)[:3]

    return {
        "revenue": revenue,
        "cogs": cogs,
        "profit": revenue - cogs,
        "transactions": len(docs),
        "items": items,
        "phones": phones,
        "voided": voided,
        "low_stock": low_stock,
        "top": top,
    }


def _recap_html(store_name: str, owner_name: str, recap: dict, period: str) -> str:
    rows = "".join(
        f'<tr><td style="padding:6px 0;color:#334155">{escape(name)}</td>'
        f'<td style="padding:6px 0;text-align:right;color:#0f172a;font-weight:600">{qty} pcs</td></tr>'
        for name, qty in recap["top"]
    ) or '<tr><td style="padding:6px 0;color:#94a3b8">Belum ada penjualan minggu ini</td></tr>'

    def line(label: str, value: str, color: str = "#0f172a") -> str:
        return (
            f'<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#475569">{label}</td>'
            f'<td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right;'
            f'font-weight:700;color:{color}">{value}</td></tr>'
        )

    return (
        '<table role="presentation" width="100%" style="background:#f8fafc;padding:24px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="600" style="max-width:600px;background:#ffffff;'
        'border:1px solid #e2e8f0;border-radius:12px;font-family:Arial,Helvetica,sans-serif">'
        '<tr><td style="padding:24px 24px 8px">'
        f'<p style="margin:0;font-size:12px;letter-spacing:1px;color:#0284c7;font-weight:700">'
        f'LAPORAN MINGGUAN</p>'
        f'<h1 style="margin:6px 0 0;font-size:20px;color:#0f172a">{escape(store_name)}</h1>'
        f'<p style="margin:4px 0 0;font-size:13px;color:#64748b">{escape(period)}</p>'
        "</td></tr>"
        '<tr><td style="padding:8px 24px 0">'
        f'<p style="margin:0 0 12px;font-size:14px;color:#334155">Halo {escape(owner_name)}, '
        "ini ringkasan toko Anda selama 7 hari terakhir.</p>"
        '<table role="presentation" width="100%" style="font-size:14px">'
        + line("Omzet penjualan", _rupiah(recap["revenue"]))
        + line("Modal / HPP", _rupiah(recap["cogs"]), "#b45309")
        + line("Keuntungan", _rupiah(recap["profit"]), "#15803d")
        + line("Jumlah transaksi", f'{recap["transactions"]} transaksi')
        + line("Item terjual", f'{recap["items"]} pcs ({recap["phones"]} unit HP)')
        + line("Transaksi dibatalkan/retur", f'{recap["voided"]}')
        + line("Produk stok menipis", f'{recap["low_stock"]} produk', "#b45309")
        + "</table>"
        '<h2 style="margin:20px 0 4px;font-size:15px;color:#0f172a">Produk terlaris</h2>'
        f'<table role="presentation" width="100%" style="font-size:14px">{rows}</table>'
        '<p style="margin:20px 0 0;font-size:13px;color:#475569">Cadangan data lengkap bisa Anda '
        "unduh sendiri kapan saja dari menu <strong>Pengguna &rsaquo; Backup Data Toko</strong> "
        "(format JSON dan CSV). Simpan di Google Drive atau flashdisk sebagai arsip.</p>"
        "</td></tr>"
        '<tr><td style="padding:16px 24px 24px">'
        f'<p style="margin:0;font-size:12px;color:#94a3b8">Email otomatis dari '
        f"{escape(EMAIL_FROM_NAME)} — dikirim setiap Minggu malam. Kami tidak pernah meminta "
        "password atau data kartu Anda melalui email.</p>"
        "</td></tr></table></td></tr></table>"
    )


async def run_weekly_reports(run_id: str) -> None:
    """Send one recap per Pemilik account, scoped to that owner's own store."""
    now_wib = datetime.now(WIB)
    period = f"{(now_wib - timedelta(days=6)).strftime('%d %b')} – {now_wib.strftime('%d %b %Y')}"

    owners = await db.users.find({"role": "pemilik", "is_active": {"$ne": False}}).to_list(1000)
    sent = 0
    for owner in owners:
        store = await db.stores.find_one({"id": owner.get("store_id")})
        if not store or not owner.get("email"):
            continue
        recap = await _store_recap(owner["store_id"])
        html = _recap_html(store.get("name", "Toko"), owner.get("name", "Pemilik"), recap, period)
        email_id = await send_email(
            to=owner["email"],
            subject=f"Laporan mingguan {store.get('name', 'toko Anda')} — {period}",
            html=html,
        )
        if email_id:
            sent += 1

    await db.cron_runs.update_one(
        {"run_id": run_id},
        {"$set": {"finished_at": datetime.now(timezone.utc), "emails_sent": sent, "owners": len(owners)}},
    )
    logger.info("weekly report cron %s: %s/%s email terkirim", run_id, sent, len(owners))


@router.post("/weekly-report")
async def weekly_report(
    request: Request,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    x_webhook_id: Optional[str] = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Unauthorized")

    envelope = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook body")

    run_id = x_webhook_id or envelope.get("run_id") or datetime.now(timezone.utc).isoformat()
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return {"status": "duplicate", "run_id": run_id}

    await db.cron_runs.insert_one({"run_id": run_id, "job": "weekly-report", "started_at": datetime.now(timezone.utc)})
    background.add_task(run_weekly_reports, run_id)
    return {"status": "accepted", "run_id": run_id}
