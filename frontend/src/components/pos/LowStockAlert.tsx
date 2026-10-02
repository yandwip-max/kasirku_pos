import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackageCheck } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = { handphone: "Handphone", aksesoris: "Aksesoris", voucher: "Voucher Data" };

/** Low-stock warning for the POS screen: anything whose sellable stock has fallen
 * below its "batas stok menipis". Quantity-based items (aksesoris & voucher) run out
 * fastest, so they are listed first. */
export default function LowStockAlert() {
  const [open, setOpen] = useState(false);

  const lowStockQuery = useQuery({
    queryKey: ["products", { lowStock: true }],
    queryFn: () => apiGet<Product[]>("/products?low_stock=true"),
    refetchInterval: 120000, // keep the badge fresh during a long shift
  });
  const items = (lowStockQuery.data ?? []).slice().sort((a, b) => {
    if (a.type === "handphone" && b.type !== "handphone") return 1;
    if (b.type === "handphone" && a.type !== "handphone") return -1;
    return a.stock - b.stock;
  });

  const emptyCount = items.filter((p) => p.stock === 0).length;
  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        data-testid="low-stock-alert-banner"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-left text-xs font-medium text-amber-900 transition-colors duration-100 hover:bg-amber-100"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          <span data-testid="low-stock-count">{items.length}</span> produk stoknya menipis
          {emptyCount > 0 ? ` (${emptyCount} sudah habis)` : ""} — klik untuk lihat daftar restok
        </span>
        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-bold">Restok</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg" data-testid="low-stock-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Daftar Stok Menipis
            </DialogTitle>
            <DialogDescription>
              Produk di bawah batas stok menipis masing-masing. Segera restok agar tidak kehilangan penjualan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {items.map((p) => (
              <div
                key={p.id}
                data-testid="low-stock-item"
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border p-3",
                  p.stock === 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50/60",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {TYPE_LABEL[p.type] ?? p.type}
                    {p.sku ? ` · ${p.sku}` : ""} · batas {p.min_stock}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 font-mono",
                    p.stock === 0
                      ? "border-red-300 bg-red-100 text-red-700"
                      : "border-amber-300 bg-amber-100 text-amber-800",
                  )}
                >
                    {p.stock === 0 ? "Habis" : `${p.stock} ${p.type === "aksesoris" ? "pcs" : "unit"}`}
                </Badge>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <PackageCheck className="h-4 w-4 shrink-0 text-slate-400" />
            Batas stok menipis tiap produk bisa diatur Pemilik di halaman Stok &amp; Produk.
          </div>

          <Button variant="outline" className="w-full" data-testid="low-stock-close-btn" onClick={() => setOpen(false)}>
            Tutup
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}