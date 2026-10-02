import { useEffect, useState } from "react";
import { Bluetooth, ExternalLink, Printer, Smartphone } from "lucide-react";
import { toast } from "sonner";
import type { Transaction } from "@/lib/types";
import ReceiptView from "@/components/ReceiptView";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { escposBytes, receiptText } from "@/lib/escpos";
import {
  applyPaperSize,
  hasWebBluetooth,
  isAndroid,
  loadPaperSize,
  PAPER_OPTIONS,
  printReceipt,
  printViaBluetooth,
  printViaRawBT,
  RAWBT_PLAY_URL,
  type PaperSize,
} from "@/lib/printer";
import { cn } from "@/lib/utils";

interface ReceiptDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** data-testid override so reprints from the history page report their own id */
  printTestId?: string;
}

export default function ReceiptDialog({ transaction, open, onOpenChange, printTestId = "receipt-print-btn" }: ReceiptDialogProps) {
  const { store } = useAuth();
  const [paper, setPaper] = useState<PaperSize>(() => loadPaperSize());
  const [sending, setSending] = useState(false);

  // the chosen paper drives the on-screen preview, the @page box and the ESC/POS line width
  useEffect(() => {
    applyPaperSize(paper);
  }, [paper]);

  const hint = PAPER_OPTIONS.find((p) => p.id === paper)?.hint ?? "";
  const thermal = paper !== "a4";

  function sendToRawBT() {
    if (!transaction) return;
    printViaRawBT(receiptText(transaction, store ?? null, paper));
    toast.info("Struk dikirim ke aplikasi RawBT. Belum terpasang? Unduh dulu dari Play Store.");
  }

  async function sendToBluetooth() {
    if (!transaction) return;
    setSending(true);
    try {
      await printViaBluetooth(escposBytes(
        receiptText(transaction, store ?? null, paper),
        transaction.items.flatMap((item) => item.service_category === "pln" && item.pln_token ? [item.pln_token] : []),
      ));
      toast.success("Struk terkirim ke printer bluetooth");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal mencetak ke printer bluetooth";
      if (!/cancell?ed|user gesture|chooser/i.test(message)) toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-sm" data-testid="receipt-dialog">
        <DialogHeader>
          <DialogTitle>Struk Pembayaran</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-slate-50 p-2.5" data-testid="receipt-paper-picker">
          <p className="mb-1.5 text-xs font-medium text-slate-600">Ukuran kertas printer</p>
          <div className="flex gap-1.5">
            {PAPER_OPTIONS.map((opt) => (
              <Button
                key={opt.id}
                size="sm"
                variant={paper === opt.id ? "default" : "outline"}
                className="flex-1 transition-transform duration-100 active:scale-[0.98]"
                data-testid={`receipt-paper-${opt.id}-btn`}
                onClick={() => setPaper(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500" data-testid="receipt-paper-hint">
            {hint}
          </p>
        </div>

        {transaction ? (
          <div
            className={cn(
              "animate-in zoom-in-95 mx-auto rounded-lg border border-slate-200 duration-200",
              paper === "58" ? "w-[220px]" : paper === "80" ? "w-[300px]" : "w-full",
            )}
          >
            <ReceiptView transaction={transaction} compact={paper === "58"} />
          </div>
        ) : null}

        {thermal && (
          <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/60 p-2.5">
            <p className="text-xs font-medium text-sky-900">Printer thermal portable / bluetooth</p>
            <div className="flex flex-col gap-1.5">
              <Button
                variant="outline"
                className="justify-start bg-white transition-transform duration-100 active:scale-[0.98]"
                data-testid="receipt-rawbt-btn"
                onClick={sendToRawBT}
              >
                <Smartphone className="h-4 w-4 text-[#0284C7]" /> Cetak lewat RawBT (Android)
              </Button>
              <Button
                variant="outline"
                className="justify-start bg-white transition-transform duration-100 active:scale-[0.98]"
                data-testid="receipt-bluetooth-btn"
                disabled={sending || !hasWebBluetooth()}
                onClick={sendToBluetooth}
              >
                <Bluetooth className="h-4 w-4 text-[#0284C7]" />
                {sending ? "Mengirim ke printer…" : "Cetak langsung via Bluetooth"}
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-sky-900/70" data-testid="receipt-thermal-help">
              {hasWebBluetooth()
                ? "Bluetooth langsung butuh Chrome Android/desktop dan printer yang sudah menyala. Bila printer tidak terdeteksi, pakai RawBT."
                : "Browser ini tidak mendukung Bluetooth langsung. Gunakan RawBT di Android, atau dialog cetak untuk printer USB/LAN."}{" "}
              <a
                href={RAWBT_PLAY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline"
                data-testid="receipt-rawbt-install-link"
              >
                Pasang RawBT <ExternalLink className="h-3 w-3" />
              </a>
              {isAndroid() ? "" : " (khusus Android)"}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1 active:scale-[0.98] transition-transform duration-100"
            data-testid={printTestId}
            onClick={() => printReceipt(paper)}
          >
            <Printer className="h-4 w-4" /> Dialog Cetak
          </Button>
          <Button variant="outline" className="flex-1" data-testid="receipt-close-btn" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
