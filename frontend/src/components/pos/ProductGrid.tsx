import { BatteryCharging, Cable, Gift, Headphones, Package, PackageX, Search, Smartphone, Zap } from "lucide-react";
import type { Product } from "@/lib/types";
import { formatRupiah } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function categoryIcon(product: Product) {
  if (product.type === "non_fisik") return Zap;
  if (product.type === "handphone") return Smartphone;
  if (product.type === "voucher") return Gift;
  if (product.category.includes("Audio")) return Headphones;
  if (product.category.includes("Charger")) return Cable;
  if (product.category.includes("Powerbank")) return BatteryCharging;
  return Package;
}

function stockLabel(product: Product): string {
  if (product.type === "non_fisik") return "Layanan";
  if (product.type === "handphone" || product.type === "voucher" || product.track_imei) return `${product.stock} unit`;
  return `${product.stock} pcs`;
}

interface ProductGridProps {
  products: Product[];
  isLoading: boolean;
  isError: boolean;
  onAdd: (product: Product) => void;
}

export default function ProductGrid({ products, isLoading, isError, onAdd }: ProductGridProps) {
  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
        <Search className="h-10 w-10" />
        <p className="text-sm">Gagal memuat katalog produk. Periksa koneksi lalu coba muat ulang halaman.</p>
      </div>
    );
  }

  return (
    <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-4">
      {isLoading &&
        Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
        ))}

      {!isLoading &&
        products.map((p) => {
          const Icon = categoryIcon(p);
          const low = p.type !== "non_fisik" && p.stock < p.min_stock;
          const hasWholesale = p.type === "voucher" && p.wholesale_price > 0;
          return (
            <div
              key={p.id}
              data-testid="pos-product-card"
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 transition-shadow duration-100 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-1">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg",
                    p.type === "non_fisik" ? "bg-emerald-50 text-emerald-700" : p.type === "voucher" ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-[#0284C7]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    low ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}
                >
                  {stockLabel(p)}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug">{p.name}</p>
              <p className="truncate text-xs text-slate-500">
                {p.type === "non_fisik" ? `${p.provider} · ${p.service_category === "ewallet" ? "E-Wallet" : p.service_category === "pln" ? "Listrik PLN" : "Pulsa"}` : p.type === "voucher" ? "Voucher Data" : p.brand || p.category}
                {p.sku ? ` · ${p.sku}` : ""}
              </p>
              {p.type === "non_fisik" && p.service_category !== "ewallet" ? (
                <p className="font-mono text-xs text-slate-500">Nominal {formatRupiah(p.denomination ?? 0)}</p>
              ) : null}
              <p className="mt-1 font-mono text-sm font-bold tracking-tight">
                {p.type === "non_fisik" && p.service_category === "ewallet" ? "Nominal fleksibel" : formatRupiah(p.sell_price)}
              </p>
              {hasWholesale && (
                <p className="font-mono text-[11px] text-violet-600" data-testid="product-card-wholesale-price">
                  Grosir {formatRupiah(p.wholesale_price)}
                </p>
              )}
              <Button
                size="sm"
                className="mt-2 w-full active:scale-[0.98] transition-transform duration-100"
                data-testid="pos-add-to-cart-btn"
                disabled={p.type !== "non_fisik" && p.stock < 1}
                onClick={() => onAdd(p)}
              >
                {p.type === "non_fisik" ? "Jual Layanan" : p.type === "handphone" ? "Pilih IMEI" : p.type === "voucher" ? "Pilih Barcode" : p.track_imei ? "Pilih IMEI" : "Tambah"}
              </Button>
            </div>
          );
        })}

      {!isLoading && products.length === 0 && (
        <div className="col-span-full flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-400">
          <PackageX className="h-10 w-10" />
          <p className="text-sm">Produk tidak ditemukan. Coba kata kunci lain.</p>
        </div>
      )}
    </div>
  );
}