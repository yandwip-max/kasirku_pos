import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { AttendanceRecord, Store, StoreSchedulePayload } from "@/lib/types";
import { StoreProfileCard } from "@/components/StoreSettings";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { store } = useAuth();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<StoreSchedulePayload>({
    opening_time: store?.opening_time ?? "08:00",
    closing_time: store?.closing_time ?? "21:00",
    timezone: store?.timezone ?? "Asia/Jakarta",
    daily_report_enabled: store?.daily_report_enabled ?? true,
  });
  const attendance = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: () => apiGet<AttendanceRecord[]>("/attendance"),
  });
  const saveHours = useMutation({
    mutationFn: (payload: StoreSchedulePayload) => apiPatch<Store>("/auth/store/schedule", payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Jam operasional dan laporan harian tersimpan");
      setHours({
        opening_time: updated.opening_time,
        closing_time: updated.closing_time,
        timezone: updated.timezone,
        daily_report_enabled: updated.daily_report_enabled,
      });
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Gagal menyimpan pengaturan toko")),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] space-y-6 p-4 lg:p-6">
        <header>
          <div className="flex items-center gap-2 text-sm font-medium text-sky-700">
            <SlidersHorizontal className="h-4 w-4" /> Konfigurasi Pemilik
          </div>
          <h1 className="mt-1 font-heading text-2xl font-extrabold">Pengaturan Toko</h1>
          <p className="text-sm text-slate-500">Atur identitas toko dan informasi yang ditampilkan pada struk.</p>
        </header>

        <StoreProfileCard />

        <Card>
          <CardContent className="space-y-5 p-4">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-5 w-5 text-sky-700" />
              <div>
                <h2 className="font-heading text-base font-bold">Jam Operasional &amp; Laporan Harian</h2>
                <p className="text-sm text-slate-500">Jam ini dipakai untuk tanggal absensi dan waktu pengiriman ringkasan transaksi.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="store-opening-time">Jam Buka Toko</Label>
                <Input id="store-opening-time" type="time" value={hours.opening_time} onChange={(event) => setHours((value) => ({ ...value, opening_time: event.target.value }))} data-testid="store-opening-time-input" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="store-closing-time">Jam Tutup Toko</Label>
                <Input id="store-closing-time" type="time" value={hours.closing_time} onChange={(event) => setHours((value) => ({ ...value, closing_time: event.target.value }))} data-testid="store-closing-time-input" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="store-timezone">Zona Waktu</Label>
                <select id="store-timezone" className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm" value={hours.timezone} onChange={(event) => setHours((value) => ({ ...value, timezone: event.target.value }))} data-testid="store-timezone-select">
                  <option value="Asia/Jakarta">WIB · Jakarta</option>
                  <option value="Asia/Makassar">WITA · Makassar</option>
                  <option value="Asia/Jayapura">WIT · Jayapura</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={hours.daily_report_enabled} onCheckedChange={(checked) => setHours((value) => ({ ...value, daily_report_enabled: checked === true }))} data-testid="daily-email-enabled-checkbox" />
              Kirim ringkasan transaksi ke email pemilik setiap hari setelah toko tutup
            </Label>
            <div>
              <Button onClick={() => saveHours.mutate(hours)} disabled={saveHours.isPending} data-testid="store-schedule-save-btn">
                {saveHours.isPending ? "Menyimpan…" : "Simpan Jam Operasional"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div>
              <h2 className="font-heading text-base font-bold">Absensi Staf Hari Ini</h2>
              <p className="text-sm text-slate-500">Waktu masuk dan pulang dicatat otomatis berdasarkan jam server dan zona waktu toko.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Tanggal</TableHead><TableHead>Masuk</TableHead><TableHead>Pulang</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(attendance.data ?? []).map((row) => (
                    <TableRow key={row.id} data-testid="attendance-row">
                      <TableCell className="font-medium">{row.user_name}</TableCell>
                      <TableCell>{row.work_date}</TableCell>
                      <TableCell>{new Date(row.check_in_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: store?.timezone ?? "Asia/Jakarta" })}</TableCell>
                      <TableCell>{row.check_out_at ? new Date(row.check_out_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: store?.timezone ?? "Asia/Jakarta" }) : "Belum absen pulang"}</TableCell>
                    </TableRow>
                  ))}
                  {!attendance.isLoading && (attendance.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-slate-400">Belum ada absensi hari ini.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-700" /> Akses dan pengguna
              </div>
              <p className="flex-1 text-sm text-slate-500">
                Kelola akun kasir dan pemilik untuk {store?.name ?? "toko ini"}. Halaman pengaturan, stok, laporan,
                dan pengelolaan akun hanya dapat dibuka oleh pemilik.
              </p>
              <Button variant="outline" render={<Link to="/users" />} className="w-fit">
                Kelola Pengguna <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
