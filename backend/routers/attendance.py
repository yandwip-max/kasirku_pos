import csv
import io
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel

from lib.auth import Principal, require
from lib.db import db
from models.attendance import Attendance, AttendanceOut, TodayAttendanceOut

router = APIRouter(prefix="/attendance")


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _row_out(row: dict) -> AttendanceOut:
    return AttendanceOut(
        **{
            **row,
            "check_in_at": _aware(row["check_in_at"]),
            "check_out_at": _aware(row.get("check_out_at")),
        }
    )


async def _store_for(principal: Principal) -> dict:
    store = await db.stores.find_one({"id": principal.store_id})
    if not store:
        raise HTTPException(status_code=404, detail="Data toko tidak ditemukan")
    return store


def _today(store: dict) -> tuple[str, ZoneInfo]:
    try:
        zone = ZoneInfo(store.get("timezone", "Asia/Jakarta"))
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("Asia/Jakarta")
    return datetime.now(zone).date().isoformat(), zone


# ── Helpers ──────────────────────────────────────────────────────────────────

def _local_fmt(dt: datetime | None, zone: ZoneInfo) -> str:
    """Format a UTC-aware datetime as HH:MM in the store's local timezone."""
    if dt is None:
        return ""
    aware = _aware(dt)
    local = aware.astimezone(zone)
    return local.strftime("%H:%M")


def _duration_minutes(check_in: datetime | None, check_out: datetime | None) -> int | None:
    """Return duration in minutes, or None if either timestamp is missing."""
    if check_in is None or check_out is None:
        return None
    return int((_aware(check_out) - _aware(check_in)).total_seconds() / 60)


# ── Pydantic output models ────────────────────────────────────────────────────

class AttendanceEmployeeSummary(BaseModel):
    user_id: str
    user_name: str
    work_days: int           # total days with check-in
    complete_days: int       # days that also have check-out
    avg_duration_minutes: int | None  # avg duration for complete days


class AttendanceReportOut(BaseModel):
    period_days: int
    date_from: str           # YYYY-MM-DD
    date_to: str             # YYYY-MM-DD
    total_records: int
    employees: list[AttendanceEmployeeSummary]


# ── Existing endpoints ────────────────────────────────────────────────────────

@router.get("/me/today", response_model=TodayAttendanceOut)
async def my_today(principal: Principal = Depends(require("transaction:read"))):
    store = await _store_for(principal)
    work_date, _ = _today(store)
    row = await db.attendance.find_one(
        {"store_id": principal.store_id, "user_id": principal.user_id, "work_date": work_date}
    )
    return TodayAttendanceOut(
        work_date=work_date,
        opening_time=store.get("opening_time", "08:00"),
        closing_time=store.get("closing_time", "21:00"),
        timezone=store.get("timezone", "Asia/Jakarta"),
        attendance=_row_out(row) if row else None,
    )


@router.post("/check-in", response_model=AttendanceOut, status_code=201)
async def check_in(principal: Principal = Depends(require("transaction:read"))):
    store = await _store_for(principal)
    work_date, _ = _today(store)
    row = Attendance(
        store_id=principal.store_id,
        user_id=principal.user_id,
        user_name=principal.name,
        work_date=work_date,
    )
    try:
        await db.attendance.insert_one(row.model_dump())
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Anda sudah absen masuk hari ini") from exc
    return _row_out(row.model_dump())


@router.post("/check-out", response_model=AttendanceOut)
async def check_out(principal: Principal = Depends(require("transaction:read"))):
    store = await _store_for(principal)
    work_date, _ = _today(store)
    row = await db.attendance.find_one_and_update(
        {
            "store_id": principal.store_id,
            "user_id": principal.user_id,
            "work_date": work_date,
            "check_out_at": None,
        },
        {"$set": {"check_out_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    if not row:
        existing = await db.attendance.find_one(
            {"store_id": principal.store_id, "user_id": principal.user_id, "work_date": work_date}
        )
        if not existing:
            raise HTTPException(status_code=409, detail="Absen masuk terlebih dahulu sebelum absen pulang")
        raise HTTPException(status_code=409, detail="Anda sudah absen pulang hari ini")
    return _row_out(row)


@router.get("", response_model=list[AttendanceOut])
async def list_attendance(
    work_date: str = Query(default="", alias="date"),
    principal: Principal = Depends(require("user:manage")),
):
    store = await _store_for(principal)
    if not work_date:
        work_date, _ = _today(store)
    try:
        date.fromisoformat(work_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Format tanggal harus YYYY-MM-DD") from exc
    rows = await db.attendance.find(
        {"store_id": principal.store_id, "work_date": work_date}
    ).sort("check_in_at", DESCENDING).to_list(500)
    return [_row_out(row) for row in rows]


# ── New owner-only endpoints ──────────────────────────────────────────────────

@router.get("/report", response_model=AttendanceReportOut)
async def attendance_report(
    days: int = Query(default=30, ge=1, le=120),
    principal: Principal = Depends(require("user:manage")),
):
    """Return an attendance summary grouped by employee for the last `days` days."""
    store = await _store_for(principal)
    _, zone = _today(store)
    today_local = datetime.now(zone).date()
    date_from = today_local - timedelta(days=days - 1)

    rows = await db.attendance.find(
        {
            "store_id": principal.store_id,
            "work_date": {"$gte": date_from.isoformat(), "$lte": today_local.isoformat()},
        }
    ).sort("work_date", ASCENDING).to_list(5000)

    # Group by employee
    emp_map: dict[str, dict] = {}
    for row in rows:
        uid = row["user_id"]
        if uid not in emp_map:
            emp_map[uid] = {
                "user_id": uid,
                "user_name": row.get("user_name", ""),
                "work_days": 0,
                "complete_days": 0,
                "durations": [],
            }
        emp_map[uid]["work_days"] += 1
        dur = _duration_minutes(row.get("check_in_at"), row.get("check_out_at"))
        if dur is not None:
            emp_map[uid]["complete_days"] += 1
            emp_map[uid]["durations"].append(dur)

    employees = []
    for emp in emp_map.values():
        durs = emp["durations"]
        avg_dur = int(sum(durs) / len(durs)) if durs else None
        employees.append(AttendanceEmployeeSummary(
            user_id=emp["user_id"],
            user_name=emp["user_name"],
            work_days=emp["work_days"],
            complete_days=emp["complete_days"],
            avg_duration_minutes=avg_dur,
        ))

    # Sort by name
    employees.sort(key=lambda e: e.user_name)

    return AttendanceReportOut(
        period_days=days,
        date_from=date_from.isoformat(),
        date_to=today_local.isoformat(),
        total_records=len(rows),
        employees=employees,
    )


@router.get("/export")
async def export_attendance_csv(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    principal: Principal = Depends(require("user:manage")),
):
    """Stream a CSV of all attendance records for the given month (pemilik only)."""
    store = await _store_for(principal)
    try:
        zone = ZoneInfo(store.get("timezone", "Asia/Jakarta"))
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("Asia/Jakarta")

    # Build date range
    date_from = date(year, month, 1)
    if month == 12:
        date_to = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        date_to = date(year, month + 1, 1) - timedelta(days=1)

    rows = await db.attendance.find(
        {
            "store_id": principal.store_id,
            "work_date": {"$gte": date_from.isoformat(), "$lte": date_to.isoformat()},
        }
    ).sort([("work_date", ASCENDING), ("check_in_at", ASCENDING)]).to_list(5000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Tanggal", "Nama Karyawan", "Jam Masuk", "Jam Pulang", "Durasi (menit)", "Status"])
    for row in rows:
        check_in = _aware(row.get("check_in_at"))
        check_out = _aware(row.get("check_out_at"))
        dur = _duration_minutes(check_in, check_out)
        status = "Lengkap" if check_out else "Belum pulang"
        writer.writerow([
            row.get("work_date", ""),
            row.get("user_name", ""),
            _local_fmt(check_in, zone),
            _local_fmt(check_out, zone),
            dur if dur is not None else "",
            status,
        ])

    month_name = date_from.strftime("%Y-%m")
    filename = f"absensi_{store.get('name', 'toko').replace(' ', '_')}_{month_name}.csv"
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
