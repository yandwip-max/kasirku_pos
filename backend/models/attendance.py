import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Attendance(BaseModel):
    id: str = Field(default_factory=_uuid)
    store_id: str
    user_id: str
    user_name: str
    work_date: str
    check_in_at: datetime = Field(default_factory=_now)
    check_out_at: Optional[datetime] = None


class AttendanceOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    work_date: str
    check_in_at: datetime
    check_out_at: Optional[datetime] = None


class TodayAttendanceOut(BaseModel):
    work_date: str
    opening_time: str
    closing_time: str
    timezone: str
    attendance: Optional[AttendanceOut] = None
