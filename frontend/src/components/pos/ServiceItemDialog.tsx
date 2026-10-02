import { useEffect, useState } from "react";
import type { Product } from "@/lib/types";
import { formatRupiah, formatThousands, parseRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ServiceItemDialog({
  product,
  onOpenChange,
  onAdd,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: Product, target: string, amount: number) => void;
}) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(0);
  const open = product !== null;
  const category = product?.service_category;

  useEffect(() => {
    if (product) {
      setTarget("");
      setAmount(product.denomination ?? 0);
    }
  }, [product]);

  const targetLabel = category === "pln" ? "Nomor Meter / ID Pelanggan" : category === "ewallet" ? "Nomor HP / Akun Tujuan" : "Nomor HP Tujuan";
  const targetValid = category === "pln"
    ? /^\d{11,13}$/.test(target.trim())
    : category === "pulsa"
      ? /^\d{9,16}$/.test(target.trim())
      : target.trim().length >= 5;
  const amountValid = category !== "ewallet" || amount >= 1000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="service-item-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detail Layanan</DialogTitle>
          <DialogDescription>{product?.name} · {product?.provider}</DialogDescription>
        </DialogHeader>
        {product ? (
          <div className="grid gap-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{product.provider} · {category === "ewallet" ? "E-Wallet" : category === "pln" ? "Listrik PLN" : "Pulsa"}</p>
              <p className="mt-1 text-slate-600">Nominal layanan: {category === "ewallet" ? "diisi saat transaksi" : formatRupiah(product.denomination ?? 0)}</p>
              {category !== "ewallet" ? <p className="mt-1 text-slate-600">Harga jual: {formatRupiah(product.sell_price)}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="service-target">{targetLabel} *</Label>
              <Input
                id="service-target"
                value={target}
                onChange={(event) => setTarget(category === "ewallet" ? event.target.value : event.target.value.replace(/\D/g, ""))}
                inputMode={category === "ewallet" ? "text" : "numeric"}
                autoComplete="off"
                placeholder={category === "pln" ? "11–13 digit" : category === "ewallet" ? "Nomor HP atau akun tujuan" : "9–16 digit"}
                data-testid="service-target-input"
              />
            </div>
            {category === "ewallet" ? (
              <div className="grid gap-2">
                <Label htmlFor="service-amount">Nominal Manual (Rp) *</Label>
                <Input
                  id="service-amount"
                  value={amount ? formatThousands(amount) : ""}
                  onChange={(event) => setAmount(parseRupiah(event.target.value))}
                  inputMode="numeric"
                  placeholder="Minimal 1.000"
                  data-testid="service-amount-input"
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button
            type="button"
            disabled={!product || !targetValid || !amountValid}
            data-testid="service-add-to-cart-btn"
            onClick={() => product && onAdd(product, target.trim(), amount)}
          >
            Tambah ke Keranjang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
