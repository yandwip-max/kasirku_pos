import { useEffect, useState } from "react";
import { Bluetooth, Download, MessageCircle, Share2 } from "lucide-react";
import { toJpeg } from "html-to-image";
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
  loadPaperSize,
  PAPER_OPTIONS,
  printViaBluetooth,
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

async function createReceiptJpg(receipt: HTMLElement, transactionNumber: string): Promise<File> {
  await document.fonts.ready;
  const dataUrl = await toJpeg(receipt, {
    backgroundColor: "#ffffff",
    cacheBust: true,
    pixelRatio: 2,
    quality: 0.94,
  });
  const blob = await (await fetch(dataUrl)).blob();
  const safeNumber = transactionNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new File([blob], `struk-${safeNumber}.jpg`, { type: "image/jpeg" });
}

export default function ReceiptDialog({ transaction, open, onOpenChange, printTestId = "receipt-print-btn" }: ReceiptDialogProps) {
  const { store } = useAuth();
  const [paper, setPaper] = useState<PaperSize>(() => loadPaperSize());
  const [sending, setSending] = useState(false);
  const [receiptJpg, setReceiptJpg] = useState<File | null>(null);
  const [creatingImage, setCreatingImage] = useState(false);
  const [sharing, setSharing] = useState(false);

  // the chosen paper drives the on-screen preview, the @page box and the ESC/POS line width
  useEffect(() => {
    applyPaperSize(paper);
  }, [paper]);

  useEffect(() => {
    let cancelled = false;
    setReceiptJpg(null);
    if (!open || !transaction) {
      setCreatingImage(false);
      return;
    }

    setCreatingImage(true);
    const prepareReceipt = async () => {
      try {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        const receipt = document.getElementById("receipt-print-area");
        if (!receipt) throw new Error("Struk belum siap dijadikan gambar.");
        const file = await createReceiptJpg(receipt, transaction.transaction_number);
        if (!cancelled) setReceiptJpg(file);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Gagal membuat gambar struk.");
      } finally {
        if (!cancelled) setCreatingImage(false);
      }
    };

    void prepareReceipt();
    return () => { cancelled = true; };
  }, [open, paper, transaction]);

  const hint = PAPER_OPTIONS.find((p) => p.id === paper)?.hint ?? "";
  const thermal = paper !== "a4";

  function downloadImage(file: File) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function shareToWhatsApp() {
    if (!transaction || !receiptJpg) return;
    if (!navigator.share || !navigator.canShare?.({ files: [receiptJpg] })) {
      downloadImage(receiptJpg);
      toast.info("JPG struk diunduh. Lampirkan gambar ini di WhatsApp.");
      return;
    }

    const shareRequest = navigator.share({
      files: [receiptJpg],
      title: `Struk ${transaction.transaction_number}`,
    });
    setSharing(true);
    void shareRequest
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          downloadImage(receiptJpg);
          toast.info("JPG struk diunduh. Lampirkan gambar ini di WhatsApp.");
          return;
        }
        toast.error("Gagal membagikan gambar struk.");
      })
      .finally(() => setSharing(false));
  }

  function downloadReceiptJpg() {
    if (!receiptJpg) return;
    downloadImage(receiptJpg);
    toast.success("Struk JPG berhasil diunduh.");
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

        <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/60 p-2.5" data-testid={printTestId}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-sky-900">
            <Share2 className="h-3.5 w-3.5" /> Bagikan Struk
          </p>
          <Button
            variant="outline"
            className="w-full justify-start bg-white transition-transform duration-100 active:scale-[0.98]"
            data-testid="receipt-whatsapp-btn"
            disabled={!transaction || !receiptJpg || creatingImage || sharing}
            onClick={shareToWhatsApp}
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            {creatingImage ? "Menyiapkan JPG…" : sharing ? "Membuka menu bagikan…" : "Bagikan ke WhatsApp"}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start bg-white transition-transform duration-100 active:scale-[0.98]"
            data-testid="receipt-download-jpg-btn"
            disabled={!receiptJpg || creatingImage || sharing}
            onClick={downloadReceiptJpg}
          >
            <Download className="h-4 w-4 text-sky-600" />
            {creatingImage ? "Menyiapkan JPG…" : "Download struk JPG"}
          </Button>
          {thermal && (
            <>
              <Button
                variant="outline"
                className="w-full justify-start bg-white transition-transform duration-100 active:scale-[0.98]"
                data-testid="receipt-bluetooth-btn"
                disabled={!transaction || sending || !hasWebBluetooth()}
                onClick={sendToBluetooth}
              >
                <Bluetooth className="h-4 w-4 text-[#0284C7]" />
                {sending ? "Mengirim ke printer…" : "Cetak langsung via Bluetooth"}
              </Button>
              <p className="text-[11px] leading-snug text-sky-900/70" data-testid="receipt-bluetooth-help">
                {hasWebBluetooth()
                  ? "Bluetooth langsung membutuhkan Chrome Android/desktop dan printer yang sudah menyala."
                  : "Browser ini tidak mendukung Bluetooth langsung. Gunakan Chrome Android atau desktop."}
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" data-testid="receipt-close-btn" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
