"""Activity trail: who changed a price, a stock unit, a password — and when.

Writes are fire-and-forget from the caller's perspective (a failed log must never
fail the business action), always stamped with the actor's store_id so the trail is
per-tenant like everything else.
"""

import logging
from typing import Any, Iterable, Mapping, Optional

from lib.auth import Principal
from lib.db import db
from models.audit import ActivityChange, ActivityLog

logger = logging.getLogger(__name__)

# Fields whose change is a PRICE change (the owner's main audit question).
PRICE_FIELDS = {"price", "cost_price", "sell_price", "wholesale_price", "price_grosir"}
STOCK_FIELDS = {"stock_qty", "min_stock"}

FIELD_LABELS: dict[str, str] = {
    "name": "Nama",
    "sku": "SKU",
    "brand": "Merek",
    "price": "Harga jual",
    "cost_price": "Harga modal",
    "sell_price": "Harga jual",
    "wholesale_price": "Harga grosir",
    "price_grosir": "Harga grosir",
    "stock_qty": "Jumlah stok",
     "min_stock": "Stok minimum",
    "track_imei": "Lacak IMEI",
    "imei": "IMEI",
    "color": "Warna",
    "capacity": "Kapasitas",
    "address": "Alamat",
    "phone": "No. WhatsApp",
}


def _fmt(field: str, value: Any) -> str:
    if value is None or value == "":
        return "-"
    if field in PRICE_FIELDS and isinstance(value, (int, float)):
        return f"Rp {int(round(value)):,}".replace(",", ".")
    if isinstance(value, bool):
        return "Aktif" if value else "Nonaktif"
    return str(value)


def diff_changes(before: Mapping[str, Any], after: Mapping[str, Any], fields: Iterable[str]) -> list[ActivityChange]:
    """Only fields that actually moved, labelled and formatted for display."""
    out: list[ActivityChange] = []
    for field in fields:
        old, new = before.get(field), after.get(field)
        if old == new:
            continue
        out.append(
            ActivityChange(
                field=FIELD_LABELS.get(field, field),
                before=_fmt(field, old),
                after=_fmt(field, new),
            )
        )
    return out


def category_for(action: str, changed_fields: Iterable[str] = ()) -> str:
    fields = set(changed_fields)
    if action in ("user:create", "user:rename", "user:password", "user:status"):
        return "akun"
    if action == "store:update":
        return "toko"
    if action in ("unit:add", "unit:delete", "transaction:void"):
        return "stok"
    if fields & PRICE_FIELDS:
        return "harga"
    if fields & STOCK_FIELDS:
        return "stok"
    return "produk"


async def log_activity(
    principal: Principal,
    action: str,
    summary: str,
    entity_name: str = "",
    changes: Optional[list[ActivityChange]] = None,
    category: Optional[str] = None,
) -> None:
    entry = ActivityLog(
        store_id=principal.store_id,
        actor_id=principal.user_id,
        actor_name=principal.name,
        actor_role=principal.role,
        action=action,  # type: ignore[arg-type]
        category=category or category_for(action, [c.field for c in (changes or [])]),  # type: ignore[arg-type]
        entity_name=entity_name,
        summary=summary,
        changes=changes or [],
    )
    try:
        await db.activity_logs.insert_one(entry.model_dump())
    except Exception:  # pragma: no cover - the audit trail must never break the action
        logger.exception("gagal menulis log aktivitas: %s", action)
