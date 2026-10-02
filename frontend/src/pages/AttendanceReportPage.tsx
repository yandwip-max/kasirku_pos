import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  Download,
  Loader2,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import type { AttendanceReport } from "@/lib/types";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "7 Hari Terakhir", days: 7 },
  { label: "14 Hari Terakhir", days: 14 },
  { label: "30 Hari Terakhir", days: 30 },
  { label: "3 Bulan Terakhir", days: 90 },
];

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

function ratePercent(complete: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((complete / total) * 100)}%`;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[#0284C7]">
            {icon}
          </span>
          {label}
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight">
          {value ?? <span className="inline-block h-8 w-24 animate-pulse rounded bg-slate-100" />}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Month / Year picker for export ───────────────────────────────────────────

function buildMonthOptions() {
  const options: { label: string; year: number; month: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(d),
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    });
  }
  return options;
}

const MONTH_OPTIONS = buildMonthOptions();

// ── Page component ────────────────────────────────────────────────────────────

export default function AttendanceReportPage() {
  const [days, setDays] = useState(30);
  const [exportKey, setExportKey] = useState(`${MONTH_OPTIONS[0].year}-${MONTH_OPTIONS[0].month}`);
  const [downloading, setDownloading] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["attendance", "report", days],
    queryFn: () => apiGet<AttendanceReport>(`/attendance/report?days=${days}`),
  });
  const report = reportQuery.data;

  const selectedMonth = MONTH_OPTIONS.find(
    (m) => `${m.year}-${m.month}` === exportKey,
  ) ?? MONTH_OPTIONS[0];

  async function handleExport() {
    setDownloading(true);
    try {
      await downloadFile(
        `/api/attendance/export?year=${selectedMonth.year}&month=${selectedMonth.month}`,
        `absensi_${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}.csv`,
      );
      toast.success("File laporan absensi berhasil diunduh");
    } catch {
      toast.error("Gagal mengunduh laporan absensi");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">
              Laporan Absensi
            </h1>
            <p className="text-sm text-slate-500">
              Rangkuman kehadiran karyawan — hanya bisa diakses oleh Pemilik.
            </p>
          </div>

          {/* Download section */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={exportKey} onValueChange={setExportKey}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Pilih bulan" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map((m) => (
                  <SelectItem key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={downloading}
              onClick={() => void handleExport()}
              data-testid="attendance-export-btn"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Unduh CSV
            </Button>
          </div>
        </div>

        {/* Period filter */}
        <div className="flex flex-wrap gap-1" data-testid="attendance-period-filter">
          {PERIOD_OPTIONS.map(({ label, days: d }) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              data-testid={`attendance-period-${d}`}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                days === d
                  ? "border-sky-600 bg-[#0284C7] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date range label */}
        {report && (
          <p className="text-xs text-slate-400">
            Periode: {formatDate(report.date_from)} – {formatDate(report.date_to)}
          </p>
        )}

        {/* Error */}
        {reportQuery.isError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Gagal memuat laporan absensi. Periksa koneksi lalu muat ulang halaman.
          </p>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            icon={<Users className="h-4 w-4" />}
            label="Total Karyawan"
            value={report ? `${report.employees.length} orang` : null}
          />
          <KpiCard
            icon={<Calendar className="h-4 w-4" />}
            label="Total Catatan"
            value={report ? `${report.total_records} hari` : null}
          />
          <KpiCard
            icon={<UserCheck className="h-4 w-4" />}
            label="Karyawan Aktif"
            value={
              report
                ? `${report.employees.filter((e) => e.work_days > 0).length} orang`
                : null
            }
          />
          <KpiCard
            icon={<Clock className="h-4 w-4" />}
            label="Rata-rata Kehadiran"
            value={
              report && report.employees.length > 0
                ? `${Math.round(
                    report.employees.reduce((s, e) => s + e.work_days, 0) /
                      report.employees.length,
                  )} hari`
                : report
                  ? "—"
                  : null
            }
          />
        </div>

        {/* Employee table */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base">Detail Kehadiran per Karyawan</CardTitle>
            <CardDescription>
              Berdasarkan data absensi dalam {days} hari terakhir
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Nama Karyawan</TableHead>
                  <TableHead className="text-right">Hari Masuk</TableHead>
                  <TableHead className="text-right">Hari Lengkap</TableHead>
                  <TableHead className="text-right">Tingkat Kelengkapan</TableHead>
                  <TableHead className="text-right">Rata-rata Durasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Memuat data…
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!reportQuery.isLoading && report && report.employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      Tidak ada data absensi untuk periode ini.
                    </TableCell>
                  </TableRow>
                )}

                {report?.employees.map((emp, idx) => {
                  const rate = (emp.work_days > 0
                    ? (emp.complete_days / emp.work_days) * 100
                    : 0);
                  const rateColor =
                    rate >= 90
                      ? "text-emerald-600"
                      : rate >= 70
                        ? "text-amber-600"
                        : "text-red-600";
                  return (
                    <TableRow key={emp.user_id} data-testid="attendance-report-row">
                      <TableCell className="font-mono text-sm font-bold text-slate-400">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-medium">{emp.user_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {emp.work_days}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {emp.complete_days}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm font-semibold", rateColor)}>
                        {ratePercent(emp.complete_days, emp.work_days)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-600">
                        {formatDuration(emp.avg_duration_minutes)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Legend */}
        <p className="text-xs text-slate-400">
          <strong>Hari Lengkap</strong> = hari yang sudah absen masuk <em>dan</em> absen pulang ·{" "}
          <strong>Tingkat Kelengkapan</strong> = Hari Lengkap ÷ Hari Masuk
        </p>
      </div>
    </AppShell>
  );
}
