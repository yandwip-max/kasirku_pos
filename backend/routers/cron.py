"""Weekly backup/recap email, driven by the platform cron in .emergent/crons.yml.

Every store's Pemilik accounts get their own store's numbers — never another
tenant's. The cron endpoint only authenticates and hands the work off.
"""

import hmac
import logging
import os
from datetime import date, datetime, time, timedelta, timezone
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


def _authorized_cron(authorization: Optional[str]) -> bool:
    token = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else ""
    secrets = (os.environ.get("CRON_SECRET", ""), os.environ.get("WEBHOOK_CRON_SECRET", ""))
    return bool(token) and any(secret and hmac.compare_digest(token, secret) for secret in secrets)


async def _store_day_recap(store_id: str, work_date: str, zone: ZoneInfo) -> dict:
    day = date.fromisoformat(work_date)
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(timezone.utc)
    docs = await db.transactions.find({
        "store_id": store_id,
        "created_at": {"$gte": start, "$lt": end},
        "status": {"$ne": "void"},
    }).to_list(20000)
    revenue = cogs = items = units = 0
    products: dict[str, int] = {}
    for doc in docs:
        revenue += int(doc.get("total", 0))
        for item in doc.get("items", []):
            quantity = int(item.get("qty", 0))
            cogs += int(item.get("cost") or 0) * quantity
            items += quantity
            if item.get("unit_id"):
                units += quantity
            name = item.get("product_name", "Produk")
            products[name] = products.get(name, 0) + quantity
    voided = await db.transactions.count_documents({
        "store_id": store_id,
        "voided_at": {"$gte": start, "$lt": end},
        "status": "void",
    })
    return {
        "revenue": revenue,
        "cogs": cogs,
        "profit": revenue - cogs,
        "transactions": len(docs),
        "items": items,
        "units": units,
        "voided": voided,
        "top": sorted(products.items(), key=lambda item: item[1], reverse=True)[:5],
    }


def _daily_email_html(store_name: str, owner_name: str, recap: dict, work_date: str, closing_time: str) -> str:
    top_rows = "".join(
        f"<tr><td>{escape(name)}</td><td style='text-align:right'>{quantity}</td></tr>"
        for name, quantity in recap["top"]
    ) or "<tr><td colspan='2'>Belum ada penjualan hari ini</td></tr>"
    return (
        "<main style='font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033'>"
        f"<p style='color:#0284c7;font-weight:bold'>LAPORAN HARIAN · TUTUP TOKO {escape(closing_time)}</p>"
        f"<h1>{escape(store_name)}</h1><p>{escape(work_date)} · Halo {escape(owner_name)}, berikut ringkasan hari ini.</p>"
        "<table style='width:100%;border-collapse:collapse' cellpadding='8'>"
        f"<tr><td>Omzet</td><td style='text-align:right'><b>{_rupiah(recap['revenue'])}</b></td></tr>"
        f"<tr><td>Modal / HPP</td><td style='text-align:right'>{_rupiah(recap['cogs'])}</td></tr>"
        f"<tr><td>Laba</td><td style='text-align:right'><b>{_rupiah(recap['profit'])}</b></td></tr>"
        f"<tr><td>Transaksi selesai</td><td style='text-align:right'>{recap['transactions']}</td></tr>"
        f"<tr><td>Item terjual</td><td style='text-align:right'>{recap['items']} ({recap['units']} unit barcode/IMEI)</td></tr>"
        f"<tr><td>Void/retur</td><td style='text-align:right'>{recap['voided']}</td></tr>"
        "</table><h2>Produk terlaris</h2>"
        f"<table style='width:100%' cellpadding='6'>{top_rows}</table>"
        f"<p style='color:#64748b;font-size:12px'>Email otomatis KasirKu untuk {escape(work_date)}.</p></main>"
    )


async def run_daily_store_reports() -> None:
    stores = await db.stores.find({"daily_report_enabled": {"$ne": False}}).to_list(10000)
    for store in stores:
        try:
            zone = ZoneInfo(store.get("timezone", "Asia/Jakarta"))
        except Exception:
            logger.exception("invalid timezone for store %s", store.get("id"))
            continue
        now_local = datetime.now(zone)
        closing_time = store.get("closing_time", "21:00")
        if now_local.strftime("%H:%M") < closing_time:
            continue
        work_date = now_local.date().isoformat()
        owners = await db.users.find({
            "store_id": store["id"], "role": "pemilik", "is_active": {"$ne": False}
        }).to_list(200)
        recap = await _store_day_recap(store["id"], work_date, zone)
        for owner in owners:
            if not owner.get("email"):
                continue
            query = {"store_id": store["id"], "user_id": owner["id"], "work_date": work_date}
            marker = await db.daily_report_runs.find_one(query)
            if marker and marker.get("status") == "sent":
                continue
            now = datetime.now(timezone.utc)
            if marker and marker.get("status") in {"sending", "failed"}:
                retry_at = marker.get("started_at") if marker.get("status") == "sending" else marker.get("finished_at")
                retry_at = _aware(retry_at or now)
                if now - retry_at < timedelta(minutes=20):
                    continue
            try:
                await db.daily_report_runs.update_one(
                    query,
                    {"$set": {"status": "sending", "started_at": now, "email": owner["email"]}},
                    upsert=True,
                )
            except Exception:
                logger.exception("could not claim daily report for store/user %s/%s", store["id"], owner["id"])
                continue
            email_id = await send_email(
                to=owner["email"],
                subject=f"Laporan transaksi harian {store.get('name', 'toko Anda')} — {work_date}",
                html=_daily_email_html(
                    store.get("name", "Toko"), owner.get("name", "Pemilik"), recap, work_date, closing_time
                ),
            )
            await db.daily_report_runs.update_one(
                query,
                {"$set": {
                    "status": "sent" if email_id else "failed",
                    "email_id": email_id,
                    "finished_at": datetime.now(timezone.utc),
                }},
            )
    logger.info("daily store closing reports dispatcher finished")


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
        f"{escape(EMAIL_FROM_NAME)} — dikirim setiap Sabtu malam. Kami tidak pernah meminta "
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
@router.get("/weekly-report")
async def weekly_report(
    request: Request,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    x_webhook_id: Optional[str] = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if not _authorized_cron(authorization):
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


@router.post("/daily-store-closing")
@router.get("/daily-store-closing")
async def daily_store_closing(
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
):
    """Every-minute dispatcher; each enabled store sends once when its local close time passes."""
    if not _authorized_cron(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    background.add_task(run_daily_store_reports)
    return {"status": "accepted"}
