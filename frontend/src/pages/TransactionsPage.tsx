import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Transaction } from "@/lib/types";
import { formatDateTime, formatRupiah } from "@/lib/format";
import AppShell from "@/components/AppShell";
import ReceiptDialog from "@/components/pos/ReceiptDialog";
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
] as const;

function itemsSummary(t: Transaction): string {
  const first = t.items[0];
  if (!first) return "-";
  const extra = t.items.length - 1;
  return extra > 0 ? `${first.product_name} +${extra} lainnya` : first.product_name;
}

export default function TransactionsPage() {
  const [period, setPeriod] = useState<string>("30d");
  const [method, setMethod] = useState<string>("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Transaction | null>(null);

  const txQuery = useQuery({
    queryKey: ["transactions", { period, method, q }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (period !== "all") params.set("period", period);
      if (method) params.set("method", method);
      if (q.trim()) params.set("q", q.trim());
      return apiGet<Transaction[]>(`/transactions?${params.toString()}`);
    },
  });
  const rows = txQuery.data ?? [];

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
          </CardContent>
        </Card>

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
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs font-semibold">{t.transaction_number}</TableCell>
                    <TableCell className="text-sm text-slate-600">{formatDateTime(t.created_at)}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm">{itemsSummary(t)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          t.payment_method === "tunai"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-sky-200 bg-sky-50 text-sky-700",
                        )}
                      >
                        {t.payment_method === "tunai" ? "Tunai" : "QRIS"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.customer_name || "-"}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">
                      {formatRupiah(t.total)}
                      {t.discount_total > 0 ? (
                        <span className="block text-[11px] font-normal text-emerald-700" data-testid="transaction-row-discount">
                          Diskon −{formatRupiah(t.discount_total)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" data-testid="transaction-detail-btn" onClick={() => setDetail(t)}>
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
    </AppShell>
  );
}