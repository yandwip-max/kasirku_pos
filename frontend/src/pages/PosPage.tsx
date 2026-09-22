import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { CartLine, CheckoutPayload, Product, ProductUnit, Transaction } from "@/lib/types";
import AppShell from "@/components/AppShell";
import ProductGrid from "@/components/pos/ProductGrid";
import ImeiUnitDialog from "@/components/pos/ImeiUnitDialog";
import CartPanel from "@/components/pos/CartPanel";
import CheckoutDialog from "@/components/pos/CheckoutDialog";
import ReceiptDialog from "@/components/pos/ReceiptDialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { id: "all", label: "Semua", testid: "pos-category-filter-all" },
  { id: "handphone", label: "Handphone", testid: "pos-category-filter-handphone" },
  { id: "accessories", label: "Aksesoris", testid: "pos-category-filter-accessories" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["id"];

const sameLine = (a: CartLine, b: CartLine) =>
  (a.unit?.id ?? `acc-${a.product.id}`) === (b.unit?.id ?? `acc-${b.product.id}`);

export default function PosPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [imeiProduct, setImeiProduct] = useState<Product | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ["products", { search, category }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (category === "handphone") params.set("type", "handphone");
      if (category === "accessories") params.set("type", "aksesoris");
      return apiGet<Product[]>(`/products?${params.toString()}`);
    },
  });
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  // F2 focuses the search box, cashier-style
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function addAccessory(product: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.unit === null && l.product.id === product.id);
      if (idx >= 0) {
        if (prev[idx].qty + 1 > product.stock) {
          toast.error("Stok tidak mencukupi");
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...prev[idx], qty: prev[idx].qty + 1 };
        return next;
      }
      if (product.stock < 1) {
        toast.error("Stok habis");
        return prev;
      }
      return [...prev, { product, unit: null, qty: 1 }];
    });
    toast.success(`${product.name} ditambahkan ke keranjang`);
  }

  function handleAdd(product: Product) {
    if (product.type === "handphone") {
      if (product.stock < 1) {
        toast.error("Belum ada unit stok untuk produk ini");
        return;
      }
      setImeiProduct(product);
    } else {
      addAccessory(product);
    }
  }

  function addPhoneUnit(product: Product, unit: ProductUnit) {
    setCart((prev) => {
      if (prev.some((l) => l.unit?.id === unit.id)) return prev;
      return [...prev, { product, unit, qty: 1 }];
    });
    toast.success(`${product.name} (IMEI ${unit.imei}) ditambahkan ke keranjang`);
  }

  const checkout = useMutation({
    mutationFn: (payload: CheckoutPayload) => apiPost<Transaction>("/transactions", payload),
    onSuccess: (trx) => {
      setReceipt(trx);
      setCheckoutOpen(false);
      setCart([]);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Transaksi berhasil disimpan");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menyimpan transaksi")),
  });

  return (
    <AppShell>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 p-4 lg:h-[calc(100svh-4.5rem)] lg:grid-cols-12 lg:overflow-hidden lg:p-6">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-8">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-center justify-between gap-4">
              <h1 className="font-heading text-lg font-bold">Katalog Produk</h1>
              <span className="text-xs text-slate-500">{products.length} produk</span>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama produk, SKU, atau nomor IMEI… (F2)"
                className="pl-9"
                data-testid="pos-search-input"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={c.testid}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    category === c.id
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <ProductGrid
            products={products}
            isLoading={productsQuery.isLoading}
            isError={productsQuery.isError}
            onAdd={handleAdd}
          />
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-4">
          <CartPanel
            cart={cart}
            onRemove={(line) => setCart((prev) => prev.filter((l) => !sameLine(l, line)))}
            onQtyChange={(line, qty) =>
              setCart((prev) => prev.map((l) => (sameLine(l, line) ? { ...l, qty } : l)))
            }
            onClear={() => setCart([])}
            onCheckout={(name, phone) => {
              setCustomer({ name, phone });
              setCheckoutOpen(true);
            }}
          />
        </section>
      </div>

      <ImeiUnitDialog
        product={imeiProduct}
        takenUnitIds={cart.flatMap((l) => (l.unit ? [l.unit.id] : []))}
        onClose={() => setImeiProduct(null)}
        onPick={(unit) => {
          if (imeiProduct) addPhoneUnit(imeiProduct, unit);
          setImeiProduct(null);
        }}
      />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        cart={cart}
        customer={customer}
        submitting={checkout.isPending}
        onConfirm={(method, amountPaid) =>
          checkout.mutate({
            items: cart.map((l) => ({ product_id: l.product.id, unit_id: l.unit?.id ?? null, qty: l.qty })),
            payment_method: method,
            amount_paid: amountPaid,
            customer_name: customer.name,
            customer_phone: customer.phone,
            cashier_name: "Kasir Pagi",
          })
        }
      />
      <ReceiptDialog transaction={receipt} open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)} />
    </AppShell>
  );
}