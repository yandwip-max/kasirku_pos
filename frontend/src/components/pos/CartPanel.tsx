import { useState } from "react";
import { BadgePercent, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import type { CartLine, DiscountType, PriceTier } from "@/lib/types";
import { isDiscountInvalid, lineDiscount, lineGross, linePrice, lineSubtotal, cartDiscount, cartGross, cartTotal } from "@/lib/cart";
import { formatRupiah, formatThousands, parseRupiah } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CartPanelProps {
  cart: CartLine[];
  onRemove: (line: CartLine) => void;
  onQtyChange: (line: CartLine, qty: number) => void;
  onDiscountChange: (line: CartLine, type: DiscountType | null, value: number) => void;
  onTierChange: (line: CartLine, tier: PriceTier) => void;
  onClear: () => void;
  onCheckout: (name: string, phone: string) => void;
}

const lineKey = (line: CartLine) => line.unit?.id ?? `acc-${line.product.id}`;

function DiscountEditor({
  line,
  onDiscountChange,
}: {
  line: CartLine;
  onDiscountChange: (line: CartLine, type: DiscountType | null, value: number) => void;
}) {
  const [open, setOpen] = useState(line.discountValue > 0);
  const type: DiscountType = line.discountType ?? "nominal";
  const invalid = isDiscountInvalid(line);
  const discount = lineDiscount(line);

  if (!open && discount === 0) {
    return (
      <button
        type="button"
        data-testid="cart-item-discount-open-btn"
        onClick={() => setOpen(true)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-[#0284C7] transition-colors duration-100 hover:text-[#0369A1]"
      >
        <BadgePercent className="h-3.5 w-3.5" /> Beri diskon
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/70 p-2" data-testid="cart-item-discount-editor">
      <div className="flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white">
          {(["nominal", "persen"] as DiscountType[]).map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`cart-item-discount-type-${t}`}
              onClick={() => onDiscountChange(line, t, line.discountValue)}
              className={cn(
                "px-2 py-1 text-xs font-bold transition-colors duration-100",
                type === t ? "bg-[#0284C7] text-white" : "text-slate-500 hover:bg-slate-50",
              )}
            >
              {t === "nominal" ? "Rp" : "%"}
            </button>
          ))}
        </div>
        <Input
          value={line.discountValue ? (type === "nominal" ? formatThousands(line.discountValue) : String(line.discountValue)) : ""}
          onChange={(e) => {
            const raw = parseRupiah(e.target.value);
            onDiscountChange(line, type, type === "persen" ? Math.min(raw, 100) : raw);
          }}
          inputMode="numeric"
          placeholder="0"
          className={cn("h-8 flex-1 font-mono text-sm", invalid && "border-red-400")}
          data-testid="cart-item-discount-input"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="cart-item-discount-clear-btn"
          onClick={() => {
            onDiscountChange(line, null, 0);
            setOpen(false);
          }}
        >
          <X className="h-3.5 w-3.5 text-slate-500" />
        </Button>
      </div>
      {invalid ? (
        <p className="mt-1 text-[11px] font-medium text-red-600" data-testid="cart-item-discount-error">
          {type === "persen" ? "Maksimal 100%" : "Diskon melebihi harga item"}
        </p>
      ) : discount > 0 ? (
        <p className="mt-1 text-[11px] text-emerald-700" data-testid="cart-item-discount-applied">
          Potongan {formatRupiah(discount)}
          {type === "persen" ? ` (${line.discountValue}%)` : ""}
        </p>
      ) : null}
    </div>
  );
}

export default function CartPanel({
  cart,
  onRemove,
  onQtyChange,
  onDiscountChange,
  onTierChange,
  onClear,
  onCheckout,
}: CartPanelProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const gross = cartGross(cart);
  const discountTotal = cartDiscount(cart);
  const total = cartTotal(cart);
  const blocked = cart.some(isDiscountInvalid);

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
          {cart.map((line) => {
            const discount = lineDiscount(line);
            return (
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
                    ) : (
                      <p className="text-[11px] text-slate-500">@ {formatRupiah(linePrice(line))}</p>
                    )}
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

                {/* Voucher lines choose retail or wholesale pricing */}
                {line.product.type === "voucher" && (
                  <div className="mt-2 flex overflow-hidden rounded-md border border-slate-200 bg-white" data-testid="cart-item-tier-switch">
                    {(["ritel", "grosir"] as PriceTier[]).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        data-testid={`cart-item-tier-${tier}`}
                        onClick={() => onTierChange(line, tier)}
                        className={cn(
                          "flex-1 px-2 py-1 text-xs font-semibold capitalize transition-colors duration-100",
                          line.priceTier === tier ? "bg-[#0284C7] text-white" : "text-slate-500 hover:bg-slate-50",
                        )}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                )}

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
                  <div className="text-right">
                    {discount > 0 && (
                      <span className="mr-1.5 font-mono text-xs text-slate-400 line-through">
                        {formatRupiah(lineGross(line))}
                      </span>
                    )}
                    <span className="font-mono text-sm font-bold" data-testid="cart-item-subtotal">
                      {formatRupiah(lineSubtotal(line))}
                    </span>
                  </div>
                </div>

                <DiscountEditor line={line} onDiscountChange={onDiscountChange} />
              </div>
            );
          })}
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
        {discountTotal > 0 && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span>Subtotal</span>
              <span className="font-mono">{formatRupiah(gross)}</span>
            </div>
            <div className="flex items-center justify-between text-emerald-700">
              <span>Total Diskon</span>
              <span className="font-mono font-semibold" data-testid="cart-total-discount">
                −{formatRupiah(discountTotal)}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Total</span>
          <span data-testid="pos-cart-total-amount" className="font-mono text-2xl font-bold tracking-tight">
            {formatRupiah(total)}
          </span>
        </div>
        <Button
          size="lg"
          className="w-full active:scale-[0.98] transition-transform duration-100"
          disabled={cart.length === 0 || blocked}
          data-testid="pos-checkout-btn"
          onClick={() => onCheckout(customerName, customerPhone)}
        >
          {blocked ? "Perbaiki diskon dulu" : "Bayar Sekarang"}
        </Button>
      </div>
    </div>
  );
}