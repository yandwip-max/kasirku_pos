import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FileSpreadsheet, HardDriveDownload, MailCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import type { Transaction, VoidPayload } from "@/lib/types";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ── Void / Retur ─────────────────────────────────────────────────────────── */

export function VoidTransactionDialog({
  transaction,
  onOpenChange,
}: {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [voidType, setVoidType] = useState<VoidPayload["void_type"]>("void");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const submit = useMutation({
    mutationFn: (payload: VoidPayload) => apiPost<Transaction>(`/transactions/${transaction?.id}/void`, payload),
    onSuccess: (updated) => {
      // stock, reports and the activity trail all move with a void
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast.success(
        `${updated.void_type === "retur" ? "Retur" : "Void"} ${updated.transaction_number} berhasil — stok sudah dikembalikan`,
      );
      setReason("");
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const detail = (err as { body?: { detail?: string } })?.body?.detail;
      toast.error(detail ?? "Gagal membatalkan transaksi");
    },
  });

  const tooShort = reason.trim().length < 3;

  return (
    <Dialog open={transaction !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="void-transaction-dialog">
        <DialogHeader>
          <DialogTitle>Batalkan Transaksi {transaction?.transaction_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-snug text-amber-900">
            Total <span className="font-semibold">{formatRupiah(transaction?.total ?? 0)}</span> akan dikeluarkan dari
            laporan penjualan dan <span className="font-semibold">stok barang dikembalikan</span>. Transaksi tidak
            dihapus — tetap tersimpan sebagai bukti dan tercatat di Riwayat Aktivitas.
          </div>

          <div className="grid gap-2">
            <Label>Jenis pembatalan</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={voidType === "void" ? "default" : "outline"}
                className="flex-1 justify-start"
                data-testid="void-type-void-btn"
                onClick={() => setVoidType("void")}
              >
                <Ban className="h-4 w-4" /> Void (salah input)
              </Button>
              <Button
                type="button"
                variant={voidType === "retur" ? "default" : "outline"}
                className="flex-1 justify-start"
                data-testid="void-type-retur-btn"
                onClick={() => setVoidType("retur")}
              >
                <Undo2 className="h-4 w-4" /> Retur (barang kembali)
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="void-reason">Alasan (wajib, minimal 3 karakter)</Label>
            <Textarea
              id="void-reason"
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={voidType === "retur" ? "cth. Unit ditukar karena layar bergaris" : "cth. Salah pilih IMEI"}
              data-testid="void-reason-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" data-testid="void-cancel-btn" onClick={() => onOpenChange(false)}>
            Kembali
          </Button>
          <Button
            variant="destructive"
            disabled={tooShort || submit.isPending}
            data-testid="void-confirm-btn"
            onClick={() => submit.mutate({ void_type: voidType, reason: reason.trim() })}
          >
            {submit.isPending ? "Memproses…" : voidType === "retur" ? "Proses Retur" : "Void Transaksi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Backup data ──────────────────────────────────────────────────────────── */

const BACKUPS = [
  { path: "/api/backup/export", label: "Cadangan Lengkap (JSON)", hint: "Semua produk, stok, transaksi & aktivitas", icon: HardDriveDownload, testid: "backup-json-btn" },
  { path: "/api/backup/xlsx/products", label: "Produk (Excel)", hint: "Kolom rapi, langsung terbaca di Excel/WPS", icon: FileSpreadsheet, testid: "backup-products-csv-btn" },
  { path: "/api/backup/xlsx/units", label: "Stok IMEI (Excel)", hint: "Nama produk, IMEI, warna, kapasitas, status", icon: FileSpreadsheet, testid: "backup-units-csv-btn" },
  { path: "/api/backup/xlsx/transactions", label: "Transaksi (Excel)", hint: "Riwayat penjualan untuk pembukuan", icon: FileSpreadsheet, testid: "backup-transactions-csv-btn" },
];

export function BackupCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  /** Sends the weekly recap to the logged-in owner's own email — no recipient input. */
  async function sendTestReport() {
    setSendingTest(true);
    try {
      const res = await apiPost<{ status: string; to: string }>("/backup/send-report-now");
      toast.success(`Email uji terkirim ke ${res.to}. Cek inbox (dan folder spam).`);
    } catch (err) {
      const detail = (err as { body?: { detail?: string } })?.body?.detail;
      toast.error(detail ?? "Gagal mengirim email uji. Coba lagi sebentar.");
    } finally {
      setSendingTest(false);
    }
  }

  /** The export endpoints need the bearer token, so the file is fetched then saved via a blob. */
  async function download(path: string, label: string) {
    setBusy(path);
    try {
      await downloadFile(path, "kasirku-backup");
      toast.success(`${label} berhasil diunduh`);
    } catch {
      toast.error(`Gagal mengunduh ${label}. Pastikan Anda sedang online.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="backup-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0284C7]/10 text-[#0284C7]">
            <Download className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-heading text-base font-bold">Backup Data Toko</h2>
            <p className="text-xs text-slate-500">
              Unduh cadangan berkala dan simpan di Google Drive atau flashdisk. Data yang diunduh hanya milik toko Anda.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {BACKUPS.map((item) => (            <Button
              key={item.path}
              variant="outline"
              disabled={busy !== null}
              data-testid={item.testid}
              className={cn(
                "h-auto flex-col items-start gap-0.5 py-2.5 text-left transition-transform duration-100 active:scale-[0.99]",
                busy === item.path && "opacity-60",
              )}
              onClick={() => download(item.path, item.label)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <item.icon className="h-4 w-4 text-[#0284C7]" />
                {busy === item.path ? "Menyiapkan…" : item.label}
              </span>
              <span className="pl-6 text-[11px] font-normal text-slate-500">{item.hint}</span>
            </Button>
          ))}
        </div>

        <p className="rounded-lg border border-sky-100 bg-sky-50/60 p-2.5 text-[11px] leading-snug text-sky-900" data-testid="backup-weekly-email-note">
          <strong>Laporan mingguan otomatis:</strong> setiap Sabtu malam 21.30 WIB, ringkasan omzet, modal/HPP, laba,
          produk terlaris, dan peringatan stok menipis dikirim ke email akun Pemilik toko ini — tanpa perlu klik. Untuk
          arsip data, unduh cadangan di atas secara berkala.
        </p>

        <Button
          variant="outline"
          className="w-full justify-center transition-transform duration-100 active:scale-[0.99] sm:w-auto"
          disabled={sendingTest}
          data-testid="send-test-report-btn"
          onClick={sendTestReport}
        >
          <MailCheck className="h-4 w-4 text-[#0284C7]" />
          {sendingTest ? "Mengirim email uji…" : "Kirim laporan uji sekarang"}
        </Button>
      </CardContent>
    </Card>
  );
}
