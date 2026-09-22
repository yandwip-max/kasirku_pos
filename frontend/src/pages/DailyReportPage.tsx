import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Coins, Receipt, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/api";
import type { DailyReport } from "@/lib/types";
import { formatCompact, formatDateShort, formatRupiah } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const RANGES = [7, 14, 30];

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
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
        {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function DailyReportPage() {
  const [days, setDays] = useState(14);
  const reportQuery = useQuery({
    queryKey: ["reports", "daily", days],
    queryFn: () => apiGet<DailyReport>(`/reports/daily?days=${days}`),
  });
  const report = reportQuery.data;
  // oldest → newest for the chart; the table stays newest-first
  const chartData = report ? [...report.rows].reverse() : [];

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">Laporan Penjualan Harian</h1>
            <p className="text-sm text-slate-500">
              Total penjualan dan keuntungan per hari (zona WIB). Laba dihitung dari harga jual − harga modal tersimpan.
            </p>
          </div>
          <div className="flex gap-1" data-testid="daily-report-range-filter">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`daily-report-range-${r}`}
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

        {reportQuery.isError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Gagal memuat laporan harian. Periksa koneksi lalu muat ulang halaman.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label="Total Penjualan"
            value={report ? formatRupiah(report.total_revenue) : null}
            hint={report ? `${report.days} hari terakhir` : undefined}
          />
          <Kpi
            icon={<Coins className="h-4 w-4" />}
            label="Total Keuntungan"
            value={
              report ? (
                <span className="text-emerald-600" data-testid="daily-report-total-profit">
                  {formatRupiah(report.total_profit)}
                </span>
              ) : null
            }
            hint={
              report && report.total_revenue > 0
                ? `Margin ${((report.total_profit / report.total_revenue) * 100).toFixed(1)}%`
                : undefined
            }
          />
          <Kpi
            icon={<Receipt className="h-4 w-4" />}
            label="Jumlah Transaksi"
            value={report ? `${report.total_transactions} trx` : null}
          />
          <Kpi
            icon={<CalendarDays className="h-4 w-4" />}
            label="Hari Terbaik"
            value={report ? (report.best_day ? formatDateShort(report.best_day) : "—") : null}
            hint={report?.best_day ? "Omset tertinggi" : undefined}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base">Penjualan vs Keuntungan Harian</CardTitle>
            <CardDescription>Batang = total penjualan, garis = keuntungan</CardDescription>
          </CardHeader>
          <CardContent>
            {report ? (
              chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatDateShort} fontSize={12} tickLine={false} axisLine={{ stroke: "#E2E8F0" }} />
                    <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={12} tickLine={false} axisLine={false} width={56} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatRupiah(value),
                        name === "revenue" ? "Penjualan" : "Keuntungan",
                      ]}
                      labelFormatter={(label: string) => formatDateShort(label)}
                      cursor={{ fill: "#F1F5F9" }}
                    />
                    <Legend formatter={(value: string) => (value === "revenue" ? "Penjualan" : "Keuntungan")} />
                    <Bar dataKey="revenue" fill="#0284C7" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    <Line type="monotone" dataKey="profit" stroke="#16A34A" strokeWidth={2} dot={{ r: 3 }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-slate-400">Belum ada penjualan pada periode ini.</p>
              )
            ) : (
              <div className="h-[300px] animate-pulse rounded-lg bg-slate-100" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base">Rincian Per Hari</CardTitle>
            <CardDescription>Hanya hari dengan transaksi yang ditampilkan, terbaru di atas</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="daily-report-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Tunai</TableHead>
                  <TableHead className="text-right">QRIS</TableHead>
                  <TableHead className="text-right">Total Penjualan</TableHead>
                  <TableHead className="text-right">Keuntungan</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportQuery.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <div className="h-8 animate-pulse rounded bg-slate-100" />
                      </TableCell>
                    </TableRow>
                  ))}
                {report?.rows.map((row) => (
                  <TableRow key={row.date} data-testid="daily-report-row">
                    <TableCell className="font-medium">
                      {formatDateShort(row.date)}
                      {row.phones_sold > 0 ? (
                        <Badge variant="outline" className="ml-2 border-sky-200 bg-sky-50 text-[10px] text-sky-700">
                          {row.phones_sold} HP
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{row.transactions}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{row.items_sold}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-500">{formatRupiah(row.cash)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-500">{formatRupiah(row.qris)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">{formatRupiah(row.revenue)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-emerald-600">
                      {formatRupiah(row.profit)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-slate-500">{row.margin_percent}%</TableCell>
                  </TableRow>
                ))}
                {report && report.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                      Belum ada penjualan pada periode ini.
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