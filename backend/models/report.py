from typing import Optional

from pydantic import BaseModel


class DailyPoint(BaseModel):
    date: str  # YYYY-MM-DD in Asia/Jakarta
    revenue: int
    transactions: int


class PaymentPoint(BaseModel):
    method: str  # tunai | qris
    count: int
    revenue: int


class TopProduct(BaseModel):
    name: str
    qty: int
    revenue: int


class ReportSummary(BaseModel):
    days: int
    total_revenue: int
    total_profit: int
    transaction_count: int
    phones_sold: int
    avg_transaction: int
    daily: list[DailyPoint]
    payment_breakdown: list[PaymentPoint]
    top_products: list[TopProduct]


class DailyRow(BaseModel):
    """One business day (Asia/Jakarta) of sales."""

    date: str
    revenue: int
    profit: int
    transactions: int
    items_sold: int
    phones_sold: int
    cash: int
    qris: int
    margin_percent: float


class DailyReport(BaseModel):
    days: int
    rows: list[DailyRow]
    total_revenue: int
    total_profit: int
    total_transactions: int
    best_day: Optional[str] = None