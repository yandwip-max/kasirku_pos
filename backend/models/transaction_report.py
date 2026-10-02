from pydantic import BaseModel


class TransactionRangeReport(BaseModel):
    """Totals for a date range on the Riwayat page (void rows excluded from money)."""

    start: str
    end: str
    transaction_count: int
    void_count: int
    total_revenue: int
    total_cogs: int
    total_profit: int
    total_discount: int
    items_sold: int
    cash_total: int
    qris_total: int
    piutang_total: int
    piutang_paid: int
    piutang_unpaid: int
