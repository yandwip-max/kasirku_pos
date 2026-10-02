import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from lib.db import db, ensure_indexes
from routers import cron as cron_router
from tests.helpers import KASIR, PEMILIK, auth_headers


def test_owner_configures_operating_hours_and_cashier_is_forbidden(client):
    owner = auth_headers(client, PEMILIK)
    cashier = auth_headers(client, KASIR)
    original = client.get("/auth/me", headers=owner).json()["store"]
    payload = {
        "opening_time": "07:30",
        "closing_time": "20:45",
        "timezone": "Asia/Jakarta",
        "daily_report_enabled": False,
    }

    denied = client.patch("/auth/store/schedule", headers=cashier, json=payload)
    assert denied.status_code == 403, denied.text

    saved = client.patch("/auth/store/schedule", headers=owner, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["opening_time"] == "07:30"
    assert saved.json()["closing_time"] == "20:45"
    assert saved.json()["daily_report_enabled"] is False

    invalid = client.patch(
        "/auth/store/schedule",
        headers=owner,
        json={**payload, "opening_time": "21:00", "closing_time": "08:00"},
    )
    assert invalid.status_code == 400, invalid.text

    restored = client.patch(
        "/auth/store/schedule",
        headers=owner,
        json={
            "opening_time": original["opening_time"],
            "closing_time": original["closing_time"],
            "timezone": original["timezone"],
            "daily_report_enabled": original["daily_report_enabled"],
        },
    )
    assert restored.status_code == 200, restored.text


def test_staff_can_check_in_and_out_once_per_store_day(client):
    owner = auth_headers(client, PEMILIK)
    email = f"attendance-{uuid.uuid4().hex[:10]}@example.com"
    created = client.post(
        "/auth/users",
        headers=owner,
        json={"name": "Kasir Absensi", "email": email, "password": "absen1234", "role": "kasir"},
    )
    assert created.status_code == 201, created.text
    cashier = auth_headers(client, {"email": email, "password": "absen1234"})

    current = client.get("/attendance/me/today", headers=cashier)
    assert current.status_code == 200, current.text
    assert current.json()["attendance"] is None

    check_in = client.post("/attendance/check-in", headers=cashier)
    assert check_in.status_code == 201, check_in.text
    assert check_in.json()["user_name"] == "Kasir Absensi"

    duplicate_in = client.post("/attendance/check-in", headers=cashier)
    assert duplicate_in.status_code == 409, duplicate_in.text

    owner_list = client.get("/attendance", headers=owner)
    assert owner_list.status_code == 200, owner_list.text
    assert any(row["user_id"] == created.json()["id"] for row in owner_list.json())

    check_out = client.post("/attendance/check-out", headers=cashier)
    assert check_out.status_code == 200, check_out.text
    assert check_out.json()["check_out_at"] is not None

    duplicate_out = client.post("/attendance/check-out", headers=cashier)
    assert duplicate_out.status_code == 409, duplicate_out.text

    forbidden_list = client.get("/attendance", headers=cashier)
    assert forbidden_list.status_code == 403, forbidden_list.text


@pytest.mark.asyncio
async def test_daily_closing_report_sends_once_per_owner_and_local_day(monkeypatch):
    await ensure_indexes()
    suffix = uuid.uuid4().hex
    store_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    zone = ZoneInfo("Asia/Jakarta")
    now_local = datetime.now(zone)
    due_close = (now_local - timedelta(minutes=2)).strftime("%H:%M")
    await db.stores.insert_one({
        "id": store_id,
        "name": f"Attendance QA {suffix}",
        "opening_time": "00:00",
        "closing_time": due_close,
        "timezone": "Asia/Jakarta",
        "daily_report_enabled": True,
        "created_at": datetime.now(zone),
    })
    await db.users.insert_one({
        "id": user_id,
        "store_id": store_id,
        "name": "Pemilik QA",
        "email": f"owner-{suffix}@example.com",
        "password_hash": "unused",
        "role": "pemilik",
        "is_active": True,
        "created_at": datetime.now(zone),
    })
    await db.daily_report_runs.delete_many({"email_id": "fake-provider-id"})
    stores_collection = db.stores

    class StoreCursor:
        async def to_list(self, _limit):
            return [await stores_collection.find_one({"id": store_id})]

    class StoreCollection:
        def find(self, _query):
            return StoreCursor()

    monkeypatch.setattr(cron_router.db, "stores", StoreCollection())
    sent: list[str] = []

    async def fake_send_email(*, to: str, subject: str, html: str):
        sent.append(to)
        assert "LAPORAN HARIAN" in html
        return "fake-provider-id"

    monkeypatch.setattr(cron_router, "send_email", fake_send_email)
    try:
        await cron_router.run_daily_store_reports()
        await cron_router.run_daily_store_reports()
        assert sent == [f"owner-{suffix}@example.com"]
        marker = await db.daily_report_runs.find_one({"store_id": store_id, "user_id": user_id})
        assert marker["status"] == "sent"
        assert marker["email_id"] == "fake-provider-id"
    finally:
        await db.daily_report_runs.delete_many({"store_id": store_id})
        await db.daily_report_runs.delete_many({"email_id": "fake-provider-id"})
        await db.users.delete_many({"store_id": store_id})
        await stores_collection.delete_many({"id": store_id})
