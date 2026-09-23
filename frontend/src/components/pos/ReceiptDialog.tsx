import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { Transaction } from "@/lib/types";
import ReceiptView from "@/components/ReceiptView";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyPaperSize, loadPaperSize, PAPER_OPTIONS, printReceipt, type PaperSize } from "@/lib/printer";
import { cn } from "@/lib/utils";

interface ReceiptDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** data-testid override so reprints from the history page report their own id */
  printTestId?: string;
}

export default function ReceiptDialog({ transaction, open, onOpenChange, printTestId = "receipt-print-btn" }: ReceiptDialogProps) {
  const [paper, setPaper] = useState<PaperSize>(() => loadPaperSize());

  // the chosen paper drives both the on-screen preview width and the @page box
  useEffect(() => {
    applyPaperSize(paper);
  }, [paper]);

  const hint = PAPER_OPTIONS.find((p) => p.id === paper)?.hint ?? "";

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

        <div className="flex gap-2">
          <Button
            className="flex-1 active:scale-[0.98] transition-transform duration-100"
            data-testid={printTestId}
            onClick={() => printReceipt(paper)}
          >
            <Printer className="h-4 w-4" /> Cetak Struk
          </Button>
          <Button variant="outline" className="flex-1" data-testid="receipt-close-btn" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
