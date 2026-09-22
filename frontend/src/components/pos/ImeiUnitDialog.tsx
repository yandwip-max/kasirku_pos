import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Smartphone } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Product, ProductUnit } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImeiUnitDialogProps {
  product: Product | null;
  takenUnitIds: string[];
  onClose: () => void;
  onPick: (unit: ProductUnit) => void;
}

export default function ImeiUnitDialog({ product, takenUnitIds, onClose, onPick }: ImeiUnitDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [product?.id]);

  const unitsQuery = useQuery({
    queryKey: ["units", { productId: product?.id, status: "in_stock" }],
    queryFn: () => apiGet<ProductUnit[]>(`/products/${product?.id}/units?status=in_stock`),
    enabled: product !== null,
  });
  const units = unitsQuery.data ?? [];
  const selected = units.find((u) => u.id === selectedId) ?? null;

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="pos-imei-select-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-[#0284C7]" />
            Pilih Unit — {product?.name}
          </DialogTitle>
          <DialogDescription>
            Setiap unit handphone dibedakan dengan nomor IMEI. Pilih unit fisik yang dijual.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50svh] space-y-2 overflow-y-auto">
          {unitsQuery.isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}

          {unitsQuery.isError && (
            <p className="py-6 text-center text-sm text-slate-500">Gagal memuat unit. Coba tutup lalu buka lagi.</p>
          )}

          {!unitsQuery.isLoading && !unitsQuery.isError && units.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              Belum ada unit stok. Tambahkan unit IMEI di halaman Stok &amp; Produk.
            </p>
          )}

          {units.map((unit) => {
            const taken = takenUnitIds.includes(unit.id);
            return (
              <button
                key={unit.id}
                type="button"
                data-testid="imei-unit-option"
                disabled={taken}
                onClick={() => setSelectedId(unit.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors duration-100",
                  selectedId === unit.id ? "border-sky-600 bg-sky-50" : "border-slate-200 hover:bg-slate-50",
                  taken && "opacity-40",
                )}
              >
                <div>
                  <p className="font-mono text-sm font-semibold">IMEI {unit.imei}</p>
                  <p className="text-xs text-slate-500">
                    {unit.color || "Warna -"} · {unit.capacity || "Kapasitas -"}
                  </p>
                </div>
                {taken ? (
                  <span className="text-xs text-slate-400">di keranjang</span>
                ) : selectedId === unit.id ? (
                  <Check className="h-4 w-4 text-[#0284C7]" />
                ) : null}
              </button>
            );
          })}
        </div>

        <Button
          className="w-full active:scale-[0.98] transition-transform duration-100"
          data-testid="imei-pick-btn"
          disabled={!selected}
          onClick={() => selected && onPick(selected)}
        >
          Pilih Unit
        </Button>
      </DialogContent>
    </Dialog>
  );
}