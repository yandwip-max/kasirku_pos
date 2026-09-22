import { useState } from "react";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import type { CartLine } from "@/lib/types";
import { formatRupiah } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CartPanelProps {
  cart: CartLine[];
  onRemove: (line: CartLine) => void;
  onQtyChange: (line: CartLine, qty: number) => void;
  onClear: () => void;
  onCheckout: (name: string, phone: string) => void;
}

const lineKey = (line: CartLine) => line.unit?.id ?? `acc-${line.product.id}`;

export default function CartPanel({ cart, onRemove, onQtyChange, onClear, onCheckout }: CartPanelProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const total = cart.reduce((sum, line) => sum + line.product.sell_price * line.qty, 0);

  return (
    <div data-testid="pos-cart-panel" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <h2 className="font-heading text-lg font-bold">
          Keranjang <span className="text-slate-400">({cart.length})</span>
        </h2>
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" data-testid="cart-clear-btn" onClick={onClear}>
            Kosongkan
          </Button>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
          <ShoppingCart className="h-10 w-10" />
          <p className="text-sm">
            Keranjang masih kosong.
            <br />
            Pilih produk untuk memulai transaksi.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {cart.map((line) => (
            <div
              key={lineKey(line)}
              data-testid="pos-cart-item"
              className="animate-in fade-in slide-in-from-right-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3 duration-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{line.product.name}</p>
                  {line.unit ? (
                    <>
                      <Badge variant="outline" className="mt-1 font-mono text-[10px]">
                        IMEI {line.unit.imei}
                      </Badge>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {line.unit.color} · {line.unit.capacity}
                      </p>
                    </>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="pos-cart-item-remove-btn"
                  onClick={() => onRemove(line)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                {line.unit ? (
                  <span className="text-xs text-slate-400">1 unit</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      data-testid="cart-qty-minus-btn"
                      disabled={line.qty <= 1}
                      onClick={() => onQtyChange(line, line.qty - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center font-mono text-sm font-bold">{line.qty}</span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      data-testid="cart-qty-plus-btn"
                      disabled={line.qty >= line.product.stock}
                      onClick={() => onQtyChange(line, line.qty + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <span className="font-mono text-sm font-bold">
                  {formatRupiah(line.product.sell_price * line.qty)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 border-t border-slate-100 p-4">
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nama pembeli (opsional)"
          data-testid="cart-customer-name-input"
        />
        <Input
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="No. WhatsApp (opsional)"
          data-testid="cart-customer-phone-input"
        />
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Total</span>
          <span data-testid="pos-cart-total-amount" className="font-mono text-2xl font-bold tracking-tight">
            {formatRupiah(total)}
          </span>
        </div>
        <Button
          size="lg"
          className="w-full active:scale-[0.98] transition-transform duration-100"
          disabled={cart.length === 0}
          data-testid="pos-checkout-btn"
          onClick={() => onCheckout(customerName, customerPhone)}
        >
          Bayar Sekarang
        </Button>
      </div>
    </div>
  );
}