import { Printer } from "lucide-react";
import type { Transaction } from "@/lib/types";
import ReceiptView from "@/components/ReceiptView";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ReceiptDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** data-testid override so reprints from the history page report their own id */
  printTestId?: string;
}

export default function ReceiptDialog({ transaction, open, onOpenChange, printTestId = "receipt-print-btn" }: ReceiptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-sm" data-testid="receipt-dialog">
        <DialogHeader>
          <DialogTitle>Struk Pembayaran</DialogTitle>
        </DialogHeader>
        {transaction ? (
          <div className="animate-in zoom-in-95 rounded-lg border border-slate-200 duration-200">
            <ReceiptView transaction={transaction} />
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            className="flex-1 active:scale-[0.98] transition-transform duration-100"
            data-testid={printTestId}
            onClick={() => window.print()}
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