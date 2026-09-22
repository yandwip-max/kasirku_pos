import { useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, QrCode } from "lucide-react";
import type { CartLine } from "@/lib/types";
import { formatRupiah, formatThousands, parseRupiah } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const QUICK_CASH = [50000, 100000, 200000, 500000, 1000000, 2000000];

/** Decorative deterministic QRIS-style pattern (simulasi — bukan kode pembayaran asli). */
function QrisPattern({ seed }: { seed: string }) {
  const SIZE = 21;
  let hash = 7;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;

  const cells: boolean[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < SIZE; x++) {
      const inCorner = (x < 7 && y < 7) || (x >= SIZE - 7 && y < 7) || (x < 7 && y >= SIZE - 7);
      if (inCorner) {
        const cx = x < 7 ? 3 : SIZE - 4;
        const cy = y < 7 ? 3 : SIZE - 4;
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        row.push(d >= 3 || d <= 1);
      } else {
        row.push((x * 31 + y * 17 + hash) % 97 % 3 !== 0);
      }
    }
    cells.push(row);
  }

  return (
    <div
      className="grid gap-px rounded-md bg-white p-2 shadow-sm"
      style={{ gridTemplateColumns: `repeat(${SIZE}, 6px)`, width: 138, height: 138 }}
    >
      {cells.flatMap((row, y) => row.map((dark, x) => <div key={`${x}-${y}`} className={dark ? "bg-slate-900" : "bg-white"} />))}
    </div>
  );
}

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartLine[];
  customer: { name: string; phone: string };
  submitting: boolean;
  onConfirm: (method: "tunai" | "qris", amountPaid: number | null) => void;
}

export default function CheckoutDialog({ open, onOpenChange, cart, customer, submitting, onConfirm }: CheckoutDialogProps) {
  const [tab, setTab] = useState<"tunai" | "qris">("tunai");
  const [cash, setCash] = useState(0);
  const [qrisPaid, setQrisPaid] = useState(false);

  const total = useMemo(() => cart.reduce((sum, line) => sum + line.product.sell_price * line.qty, 0), [cart]);

  useEffect(() => {
    if (open) {
      setTab("tunai");
      setCash(0);
      setQrisPaid(false);
    }
  }, [open]);

  const change = cash - total;
  const canSubmit = total > 0 && (tab === "tunai" ? cash >= total : qrisPaid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="checkout-dialog">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
          <DialogDescription>
            {customer.name ? `Pelanggan: ${customer.name} · ` : ""}Total belanja{" "}
            <span className="font-mono font-bold text-slate-900">{formatRupiah(total)}</span>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as "tunai" | "qris")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="tunai" data-testid="checkout-payment-cash-tab">
              <Banknote className="h-4 w-4" /> Tunai
            </TabsTrigger>
            <TabsTrigger value="qris" data-testid="checkout-payment-qris-tab">
              <QrCode className="h-4 w-4" /> QRIS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tunai" className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="checkout-quick-cash-btn"
                onClick={() => setCash(total)}
              >
                Uang Pas
              </Button>
              {QUICK_CASH.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="checkout-quick-cash-btn"
                  onClick={() => setCash(value)}
                >
                  {formatThousands(value)}
                </Button>
              ))}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Uang Diterima</label>
              <Input
                value={cash ? formatThousands(cash) : ""}
                onChange={(e) => setCash(parseRupiah(e.target.value))}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 font-mono text-lg font-bold"
                data-testid="checkout-cash-received-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit && !submitting) onConfirm("tunai", cash);
                }}
              />
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-right">
              {change >= 0 ? (
                <p className="text-sm text-slate-600">
                  Kembalian:{" "}
                  <span data-testid="checkout-change-amount" className="font-mono text-xl font-bold text-emerald-600">
                    {formatRupiah(change)}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  Kurang:{" "}
                  <span data-testid="checkout-change-amount" className="font-mono text-xl font-bold text-red-600">
                    {formatRupiah(-change)}
                  </span>
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="qris" className="mt-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-blue-100 bg-[#EFF6FF] p-4">
              <QrisPattern seed={customer.phone || "KASIRKU-QRIS"} />
              <p className="text-center text-xs leading-relaxed text-slate-600">
                NMID: ID1024567890123 · <span className="font-semibold">KASIRKU CELL &amp; ACCESSORIES</span>
                <br />
                Scan dengan aplikasi bank / e-wallet Anda
              </p>
              {qrisPaid ? (
                <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700" data-testid="qris-paid-badge">
                  <CheckCircle2 className="h-3 w-3" /> Pembayaran QRIS diterima
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="qris-simulate-success-btn"
                  onClick={() => setQrisPaid(true)}
                >
                  Simulasi QRIS Berhasil
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <Button
          size="lg"
          className="w-full active:scale-[0.98] transition-transform duration-100"
          disabled={!canSubmit || submitting}
          data-testid="checkout-submit-btn"
          onClick={() => onConfirm(tab, tab === "tunai" ? cash : null)}
        >
          {submitting ? "Menyimpan…" : "Simpan & Cetak Struk"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}