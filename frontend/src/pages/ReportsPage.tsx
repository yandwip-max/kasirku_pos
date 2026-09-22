import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Receipt, Smartphone, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/api";
import type { ReportSummary } from "@/lib/types";
import { formatCompact, formatDateShort, formatRupiah } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90];
const METHOD_COLORS: Record<string, string> = { tunai: "#16A34A", qris: "#0284C7" };

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[#0284C7]">{icon}</span>
          {label}
        </div>
        <div className="mt-3 font-mono text-2xl font-bold tracking-tight">
          {value ?? <span className="inline-block h-8 w-28 animate-pulse rounded bg-slate-100" />}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const summaryQuery = useQuery({
    queryKey: ["reports", days],
    queryFn: () => apiGet<ReportSummary>(`/reports/summary?days=${days}`),
  });
  const summary = summaryQuery.data;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">Laporan Penjualan</h1>
            <p className="text-sm text-slate-500">Ringkasan omset, tren harian, dan produk terlaris.</p>
          </div>
          <div className="flex gap-1" data-testid="report-filter-date">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`report-filter-date-${r}`}
                onClick={() => setDays(r)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                  days === r
                    ? "border-sky-600 bg-[#0284C7] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {r} Hari
              </button>
            ))}
          </div>
        </div>

        {summaryQuery.isError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Gagal memuat laporan. Periksa koneksi lalu muat ulang halaman.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <KpiCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Omset Penjualan"
            value={summary ? formatRupiah(summary.total_revenue) : null}
          />
          <KpiCard
            icon={<Receipt className="h-4 w-4" />}
            label="Jumlah Transaksi"
            value={summary ? `${summary.transaction_count} trx` : null}
          />
          <KpiCard
            icon={<Smartphone className="h-4 w-4" />}
            label="Handphone Terjual"
            value={summary ? `${summary.phones_sold} unit` : null}
          />
          <KpiCard
            icon={<BarChart3 className="h-4 w-4" />}
            label="Rata-rata Transaksi"
            value={summary ? formatRupiah(summary.avg_transaction) : null}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-heading text-base">Tren Omset Harian</CardTitle>
              <CardDescription>Total penjualan per hari (zona WIB)</CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={summary.daily} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatDateShort} fontSize={12} tickLine={false} axisLine={{ stroke: "#E2E8F0" }} />
                    <YAxis
                      tickFormatter={(value: number) => formatCompact(value)}
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value: number) => formatRupiah(value)}
                      labelFormatter={(label: string) => formatDateShort(label)}
                      cursor={{ fill: "#F1F5F9" }}
                    />
                    <Bar dataKey="revenue" fill="#0284C7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] animate-pulse rounded-lg bg-slate-100" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-base">Metode Pembayaran</CardTitle>
              <CardDescription>Proporsi omset Tunai vs QRIS</CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                summary.payment_breakdown.length > 0 ? (
                  <div className="space-y-3">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={summary.payment_breakdown}
                          dataKey="revenue"
                          nameKey="method"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {summary.payment_breakdown.map((entry) => (
                            <Cell key={entry.method} fill={METHOD_COLORS[entry.method] ?? "#6366F1"} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [formatRupiah(value), name === "tunai" ? "Tunai" : "QRIS"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col items-center gap-1.5">
                      {summary.payment_breakdown.map((p) => (
                        <div key={p.method} className="flex items-center gap-2 text-sm">
                          <span className="h-3 w-3 rounded-sm" style={{ background: METHOD_COLORS[p.method] ?? "#6366F1" }} />
                          <span className="font-medium">{p.method === "tunai" ? "Tunai" : "QRIS"}</span>
                          <span className="text-slate-500">
                            {p.count} trx · {formatRupiah(p.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="py-12 text-center text-sm text-slate-400">Belum ada transaksi pada periode ini.</p>
                )
              ) : (
                <div className="h-[180px] animate-pulse rounded-lg bg-slate-100" />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base">Top 5 Produk Terlaris</CardTitle>
            <CardDescription>Berdasarkan omset dalam {days} hari terakhir</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Omset</TableHead>
                  <TableHead className="text-right">Porsi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary && summary.top_products.length > 0
                  ? summary.top_products.map((p, idx) => (
                      <TableRow key={p.name}>
                        <TableCell className="font-mono text-sm font-bold text-slate-400">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{p.qty}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-bold">{formatRupiah(p.revenue)}</TableCell>
                        <TableCell className="text-right text-sm text-slate-500">
                          {summary.total_revenue > 0 ? `${((p.revenue / summary.total_revenue) * 100).toFixed(1)}%` : "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
                {!summaryQuery.isLoading && summary && summary.top_products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">
                      Belum ada penjualan pada periode ini.
                    </TableCell>
                  </TableRow>
                )}
                {summaryQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <div className="h-8 animate-pulse rounded bg-slate-100" />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}