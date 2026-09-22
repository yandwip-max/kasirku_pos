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
    transaction_count: int
    phones_sold: int
    avg_transaction: int
    daily: list[DailyPoint]
    payment_breakdown: list[PaymentPoint]
    top_products: list[TopProduct]