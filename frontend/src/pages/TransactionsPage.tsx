import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Ban, X, FileSpreadsheet, Zap } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Transaction, TransactionRangeReport } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { VoidTransactionDialog } from "@/components/DataTools";
import { formatDateShort, formatDateTime, formatRupiah } from "@/lib/format";
import { downloadFile } from "@/lib/download";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import ReceiptDialog from "@/components/pos/ReceiptDialog";
import PlnTokenDialog from "@/components/pos/PlnTokenDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PERIODS = [
  { id: "today", label: "Hari Ini" },
  { id: "7d", label: "7 Hari" },
  { id: "30d", label: "30 Hari" },
  { id: "all", label: "Semua" },
] as const;

const METHODS = [
  { id: "", label: "Semua Metode" },
  { id: "tunai", label: "Tunai" },
  { id: "qris", label: "QRIS" },
  { id: "piutang", label: "Piutang" },
] as const;

function itemsSummary(t: Transaction): string {  const first = t.items[0];
  if (!first) return "-";
  const extra = t.items.length - 1;
  return extra > 0 ? `${first.product_name} +${extra} lainnya` : first.product_name;
}

/** One KPI tile inside the date-range report card. */
function RangeStat({
  label,
  value,
  tone = "text-slate-900",
  testid,
}: {
  label: string;
  value: string;
  tone?: string;
  testid: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("font-mono text-sm font-bold", tone)} data-testid={testid}>
        {value}
      </p>
    </div>
  );
}

export default function TransactionsPage() {  const [period, setPeriod] = useState<string>("30d");
  const [method, setMethod] = useState<string>("");
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // an explicit date range overrides the quick period chips
  const useRange = startDate !== "" || endDate !== "";
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [plnTokenTarget, setPlnTokenTarget] = useState<{ transaction: Transaction; itemIndex: number } | null>(null);
  const [voidTarget, setVoidTarget] = useState<Transaction | null>(null);
  const { permissions, isOwner } = useAuth();
  // isOwner covers the boot window before /auth/me hands back the permission list
  const canVoid = isOwner || permissions.includes("transaction:void");

  const txQuery = useQuery({
    queryKey: ["transactions", { period, method, q, startDate, endDate }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (useRange) {
        if (startDate) params.set("start", startDate);
        if (endDate) params.set("end", endDate);
      } else if (period !== "all") {
        params.set("period", period);
      }
      if (method) params.set("method", method);
      if (q.trim()) params.set("q", q.trim());
      return apiGet<Transaction[]>(`/transactions?${params.toString()}`);
    },
  });
  const rows = txQuery.data ?? [];

  const reportQuery = useQuery({
    queryKey: ["transactions", "report", { startDate, endDate, method }],
    enabled: useRange && isOwner,
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      if (method) params.set("method", method);
      return apiGet<TransactionRangeReport>(`/transactions/report?${params.toString()}`);
    },
  });
  const report = reportQuery.data;
  const [downloading, setDownloading] = useState(false);

  /** Excel of the active range: a totals sheet plus one row per sale. */
  async function exportRange() {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      if (method) params.set("method", method);
      await downloadFile(`/api/transactions/report/xlsx?${params.toString()}`, "kasirku-transaksi.xlsx");
      toast.success("Laporan Excel berhasil diunduh");
    } catch {
      toast.error("Gagal mengunduh laporan. Pastikan Anda sedang online.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Riwayat Transaksi</h1>
          <p className="text-sm text-slate-500">Cari, filter, dan cetak ulang struk penjualan.</p>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari no. struk, nama pembeli, IMEI…"
                className="pl-9"
                data-testid="transaction-search-input"
              />
            </div>
            <div className="flex gap-1" data-testid="transaction-filter-period">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`transaction-filter-period-${p.id}`}
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    period === p.id
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`transaction-filter-method-${m.id || "all"}`}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    method === m.id
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex w-full flex-wrap items-end gap-2 border-t pt-3" data-testid="transaction-date-range">
              <div className="grid gap-1">
                <label htmlFor="trx-start" className="text-xs font-medium text-slate-500">
                  Dari tanggal
                </label>
                <Input
                  id="trx-start"
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  className="w-40"
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="transaction-start-date-input"
                />
              </div>
              <div className="grid gap-1">
                <label htmlFor="trx-end" className="text-xs font-medium text-slate-500">
                  Sampai tanggal
                </label>
                <Input
                  id="trx-end"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  className="w-40"
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="transaction-end-date-input"
                />
              </div>
              {useRange && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="transaction-range-reset-btn"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Hapus rentang
                </Button>
              )}
              <p className="text-xs text-slate-400">
                {useRange
                  ? "Rentang tanggal aktif — filter cepat di atas diabaikan."
                  : "Pilih tanggal untuk laporan transaksi per periode tertentu."}
              </p>
            </div>
          </CardContent>
        </Card>

        {useRange && report && (
          <Card data-testid="transaction-range-report">
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-base font-bold">
                  Laporan {startDate ? formatDateShort(startDate) : "awal"} –{" "}
                  {endDate ? formatDateShort(endDate) : "hari ini"}
                </h2>
                <span className="text-xs text-slate-500" data-testid="range-report-meta">
                  {report.transaction_count} transaksi · {report.items_sold} item terjual
                  {report.void_count > 0 ? ` · ${report.void_count} dibatalkan (tidak dihitung)` : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloading}
                  data-testid="range-export-xlsx-btn"
                  className="transition-transform duration-100 active:scale-[0.98]"
                  onClick={exportRange}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#0284C7]" />
                  {downloading ? "Menyiapkan…" : "Unduh Excel"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <RangeStat label="Omzet" value={formatRupiah(report.total_revenue)} testid="range-revenue" />
                <RangeStat label="Modal / HPP" value={formatRupiah(report.total_cogs)} tone="text-amber-600" testid="range-cogs" />
                <RangeStat label="Keuntungan" value={formatRupiah(report.total_profit)} tone="text-emerald-700" testid="range-profit" />
                <RangeStat label="Total Diskon" value={formatRupiah(report.total_discount)} testid="range-discount" />
<RangeStat label="Tunai" value={formatRupiah(report.cash_total)} testid="range-cash" />
                 <RangeStat label="QRIS" value={formatRupiah(report.qris_total)} testid="range-qris" />
                 <RangeStat label="Piutang" value={formatRupiah(report.piutang_total)} tone="text-amber-700" testid="range-piutang" />
                <RangeStat label="Piutang Lunas" value={formatRupiah(report.piutang_paid)} tone="text-emerald-700" testid="range-piutang-paid" />
                <RangeStat label="Sisa Piutang" value={formatRupiah(report.piutang_unpaid)} tone="text-amber-700" testid="range-piutang-unpaid" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Struk</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {txQuery.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <div className="h-8 animate-pulse rounded bg-slate-100" />
                      </TableCell>
                    </TableRow>
                  ))}
                {rows.map((t) => {
                  const pendingPlnItem = t.items.findIndex((item) => item.service_category === "pln" && !item.pln_token);
                  return (
                  <TableRow key={t.id} className={cn(t.status === "void" && "bg-rose-50/50")} data-testid="transaction-row">
                    <TableCell className="font-mono text-xs font-semibold">
                      {t.transaction_number}
                      {t.status === "void" && (
                        <Badge
                          variant="outline"
                          className="ml-1 border-rose-200 bg-rose-50 text-rose-700"
                          data-testid="transaction-void-badge"
                        >
                          {t.void_type === "retur" ? "Retur" : "Dibatalkan"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{formatDateTime(t.created_at)}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm">{itemsSummary(t)}</TableCell>
                    <TableCell>
                      <div className="grid justify-items-start gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          t.payment_method === "tunai"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : t.payment_method === "qris"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {t.payment_method === "tunai" ? "Tunai" : t.payment_method === "qris" ? "QRIS" : "Piutang"}
                      </Badge>
                      {t.payment_method === "piutang" ? (
                        <Badge variant="outline" className={t.piutang_status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"} data-testid="transaction-debt-status">
                          {t.piutang_status === "paid" ? "Lunas" : "Belum Lunas"}
                        </Badge>
                      ) : null}
                      {t.payment_method === "piutang" && t.piutang_paid_at ? (
                        <span className="text-[11px] text-slate-500" data-testid="transaction-debt-paid-at">
                          Lunas {formatDateTime(t.piutang_paid_at)}
                        </span>
                      ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{t.customer_name || "-"}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">
                      <span className={cn(t.status === "void" && "text-slate-400 line-through")}>
                        {formatRupiah(t.total)}
                      </span>
                      {t.discount_total > 0 ? (
                        <span className="block text-[11px] font-normal text-emerald-700" data-testid="transaction-row-discount">
                          Diskon −{formatRupiah(t.discount_total)}
                        </span>
                      ) : null}
                      {t.status === "void" && t.void_reason ? (
                        <span className="block text-[11px] font-normal text-rose-600" data-testid="transaction-void-reason">
                          {t.void_reason} · oleh {t.voided_by}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {pendingPlnItem >= 0 && t.status !== "void" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label="Catat token PLN"
                            data-testid="transaction-save-pln-token-btn"
                            onClick={() => setPlnTokenTarget({ transaction: t, itemIndex: pendingPlnItem })}
                          >
                            <Zap className="h-3.5 w-3.5" /> Token PLN
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" data-testid="transaction-detail-btn" onClick={() => setDetail(t)}>
                          Detail
                        </Button>
                        {canVoid && t.status !== "void" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-rose-200 text-rose-700 hover:bg-rose-50"
                            data-testid="transaction-void-btn"
                            onClick={() => setVoidTarget(t)}
                          >
                            <Ban className="h-3.5 w-3.5" /> Batalkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
                {!txQuery.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
                      Tidak ada transaksi pada filter ini.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ReceiptDialog
        transaction={detail}
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        printTestId="transaction-reprint-btn"
      />

      <PlnTokenDialog
        transaction={plnTokenTarget?.transaction ?? null}
        itemIndex={plnTokenTarget?.itemIndex ?? null}
        onOpenChange={(open) => !open && setPlnTokenTarget(null)}
        onSaved={() => setPlnTokenTarget(null)}
      />

      <VoidTransactionDialog transaction={voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)} />
    </AppShell>
  );
}