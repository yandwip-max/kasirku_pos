import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Barcode, Search } from "lucide-react";
import { apiGet, apiPost, OfflineError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { linePrice, cartTotal, cartGross, cartDiscount, lineDiscount, lineSubtotal } from "@/lib/cart";
import { enqueueSale, newClientRef, pendingLinesFromCart } from "@/lib/offlineQueue";
import type { CartLine, CheckoutPayload, DiscountType, PaymentMethod, PriceTier, Product, ProductScanResult, ProductUnit, Transaction } from "@/lib/types";
import AppShell from "@/components/AppShell";
import ProductGrid from "@/components/pos/ProductGrid";
import { useCategories } from "@/components/CategoryManager";
import LowStockAlert from "@/components/pos/LowStockAlert";
import AttendancePanel from "@/components/AttendancePanel";
import ImeiUnitDialog from "@/components/pos/ImeiUnitDialog";
import CartPanel from "@/components/pos/CartPanel";
import CheckoutDialog from "@/components/pos/CheckoutDialog";
import PiutangReminderPanel from "@/components/pos/PiutangReminderPanel";
import ReceiptDialog from "@/components/pos/ReceiptDialog";
import ServiceItemDialog from "@/components/pos/ServiceItemDialog";
import PlnTokenDialog from "@/components/pos/PlnTokenDialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { id: "all", label: "Semua", testid: "pos-category-filter-all" },
  { id: "handphone", label: "Handphone", testid: "pos-category-filter-handphone" },
  { id: "accessories", label: "Aksesoris", testid: "pos-category-filter-accessories" },
  { id: "voucher", label: "Voucher Data", testid: "pos-category-filter-voucher" },
  { id: "lainnya", label: "Lainnya", testid: "pos-category-filter-lainnya" },
  { id: "non_fisik", label: "Non-Fisik", testid: "pos-category-filter-non-fisik" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["id"];

const sameLine = (a: CartLine, b: CartLine) => {
  if (a.product.type === "non_fisik" || b.product.type === "non_fisik") return a.serviceLineId === b.serviceLineId;
  return (a.unit?.id ?? `acc-${a.product.id}`) === (b.unit?.id ?? `acc-${b.product.id}`);
};

/** Receipt shown for a sale stored on the device: it has no server transaction number yet. */
function offlineReceipt(cart: CartLine[], payload: CheckoutPayload, cashierName: string, storeId: string): Transaction {
  const total = cartTotal(cart);
  return {
    id: payload.client_ref ?? newClientRef(),
    store_id: storeId,
    transaction_number: "OFFLINE — menunggu sinkronisasi",
    items: cart.map((line) => ({
      product_id: line.product.id,
      product_name: line.product.name,
      unit_id: line.unit?.id ?? null,
      imei: line.unit?.imei ?? null,
      barcode: line.unit?.barcode ?? null,
      color: line.unit?.color ?? null,
      capacity: line.unit?.capacity ?? null,
      service_category: line.product.service_category ?? null,
      provider: line.product.provider ?? null,
      service_target: line.serviceTarget ?? null,
      service_amount: line.serviceAmount ?? null,
      pln_token: null,
      qty: line.qty,
      price: linePrice(line),
      price_tier: line.priceTier,
      cost: null,
      discount_type: lineDiscount(line) > 0 ? line.discountType : null,
      discount_value: lineDiscount(line) > 0 ? line.discountValue : 0,
      discount: lineDiscount(line),
      subtotal: lineSubtotal(line),
    })),
    gross_total: cartGross(cart),
    discount_total: cartDiscount(cart),
    total,
    profit: null,
    payment_method: payload.payment_method,
    amount_paid: payload.amount_paid ?? (payload.payment_method === "piutang" ? 0 : total),
    change_amount: (payload.amount_paid ?? (payload.payment_method === "piutang" ? 0 : total)) - total,
    customer_name: payload.customer_name,
    customer_phone: payload.customer_phone,
    cashier_name: cashierName,
    client_ref: payload.client_ref ?? null,
    created_at: payload.offline_created_at ?? new Date().toISOString(),
    status: "selesai",
    void_type: null,
    void_reason: "",
    voided_by: "",
    voided_at: null,
    due_date: payload.due_date ?? null,
    piutang_status: payload.payment_method === "piutang" ? "unpaid" : null,
    piutang_paid_at: null,
  };
}

export default function PosPage() {
  const { user, store } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [folder, setFolder] = useState("");
  const folders = useCategories().data ?? [];
  const [cart, setCart] = useState<CartLine[]>([]);
  const [imeiProduct, setImeiProduct] = useState<Product | null>(null);
  const [serviceProduct, setServiceProduct] = useState<Product | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const [plnTokenItemIndex, setPlnTokenItemIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ["products", { search, category, folder }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (category === "handphone") params.set("type", "handphone");
      if (category === "accessories") params.set("type", "aksesoris");
      if (category === "voucher") params.set("type", "voucher");
      if (category === "lainnya") params.set("type", "lainnya");
      if (category === "non_fisik") params.set("type", "non_fisik");
      if (folder) params.set("category", folder);
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
      return [...prev, { product, unit: null, qty: 1, priceTier: "ritel", discountType: null, discountValue: 0 }];
    });
    toast.success(`${product.name} ditambahkan ke keranjang`);
  }

  function handleAdd(product: Product) {
    if (product.type === "non_fisik") {
      setServiceProduct(product);
      return;
    }
    if (product.type === "handphone" || product.type === "voucher" || product.track_imei) {
      if (product.stock < 1) {
        toast.error(product.type === "voucher" ? "Belum ada barcode voucher yang tersedia" : "Belum ada unit stok untuk produk ini");
        return;
      }
      setImeiProduct(product);
    } else {
      addAccessory(product);
    }
  }

  function addScannedUnit(product: Product, unit: ProductUnit) {
    if (cart.some((line) => line.unit?.id === unit.id)) {
      toast.error("Barcode ini sudah ada di keranjang");
      return;
    }
    setCart((prev) => {
      return [...prev, { product, unit, qty: 1, priceTier: "ritel", discountType: null, discountValue: 0 }];
    });
    toast.success(`${product.name} (${unit.barcode || `IMEI ${unit.imei}`}) ditambahkan ke keranjang`);
  }

  async function scanBarcode(code: string) {
    const scanned = code.trim();
    if (!scanned) return;
    try {
      const result = await apiGet<ProductScanResult>(`/products/scan/${encodeURIComponent(scanned)}`);
      if (result.unit) addScannedUnit(result.product, result.unit);
      else handleAdd(result.product);
      setScanCode("");
      scanRef.current?.focus();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Barcode tidak terdaftar atau unit sudah terjual"));
    }
  }

  function finishSale(trx: Transaction) {
    setReceipt(trx);
    setCheckoutOpen(false);
    setCart([]);
  }

  /** Online: POST straight away. Offline: queue in IndexedDB and print a local receipt. */
   async function confirmCheckout(method: PaymentMethod, amountPaid: number | null, dueDate: string | null = null) {
    if (cart.length === 0) return;
    const hasNonPhysical = cart.some((line) => line.product.type === "non_fisik");
    if (hasNonPhysical && !navigator.onLine) {
      toast.error("Transaksi layanan digital memerlukan koneksi internet.");
      return;
    }
    const clientRef = newClientRef();
    const payload: CheckoutPayload = {
      items: cart.map((l) => ({
        product_id: l.product.id,
        unit_id: l.unit?.id ?? null,
        qty: l.qty,
        price_tier: l.priceTier,
        discount_type: l.discountType,
        discount_value: l.discountValue,
        service_target: l.serviceTarget ?? null,
        service_amount: l.serviceAmount ?? null,
      })),
      payment_method: method,
      amount_paid: amountPaid,
      customer_name: customer.name,
      customer_phone: customer.phone,
      client_ref: clientRef,
      offline_created_at: new Date().toISOString(),
      due_date: dueDate,
    };

    setSubmitting(true);
    try {
      if (!navigator.onLine) throw new OfflineError();
      const trx = await apiPost<Transaction>("/transactions", payload);
      finishSale(trx);
      const pendingPlnToken = trx.items.findIndex((item) => item.service_category === "pln" && !item.pln_token);
      setPlnTokenItemIndex(pendingPlnToken >= 0 ? pendingPlnToken : null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Transaksi berhasil disimpan");
    } catch (err) {
      if (err instanceof OfflineError) {
        if (hasNonPhysical) {
          toast.error("Koneksi terputus. Transaksi layanan belum dicatat; periksa riwayat sebelum mencoba lagi.");
          return;
        }
        await enqueueSale({
          client_ref: clientRef,
          store_id: store?.id ?? "",
          payload,
          total: cartTotal(cart),
          item_count: cart.reduce((sum, l) => sum + l.qty, 0),
          lines: pendingLinesFromCart(cart, linePrice),
          created_at: payload.offline_created_at ?? new Date().toISOString(),
        });
        finishSale(offlineReceipt(cart, payload, user?.name ?? "Kasir", store?.id ?? ""));
        toast.success("Tersimpan offline — akan terkirim otomatis saat internet kembali");
      } else {
        toast.error(apiErrorMessage(err, "Gagal menyimpan transaksi"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const checkoutBusy = submitting;

  return (
    <AppShell>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 p-4 lg:h-[calc(100svh-4.5rem)] lg:grid-cols-12 lg:overflow-hidden lg:p-6">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-8">
          <LowStockAlert />
          <div className="px-4 pt-3 lg:px-4">
            <AttendancePanel />
            <PiutangReminderPanel />
          </div>
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
                placeholder="Cari produk untuk ditambahkan manual: nama, SKU, IMEI… (F2)"
                className="pl-9"
                data-testid="pos-search-input"
              />
            </div>
            <form
              className="relative mt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void scanBarcode(scanCode);
              }}
            >
              <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={scanRef}
                value={scanCode}
                onChange={(event) => setScanCode(event.target.value)}
                placeholder="Scan barcode / IMEI lalu tekan Enter"
                className="pl-9 font-mono"
                autoComplete="off"
                data-testid="pos-barcode-input"
              />
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={c.testid}
                  onClick={() => {
                    setCategory(c.id);
                    setFolder("");
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    category === c.id && folder === ""
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {c.label}
                </button>
              ))}
              {/* shop-defined folders (CCTV, Sparepart, Parfum, …) */}
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  data-testid="pos-folder-filter-chip"
                  onClick={() => {
                    setCategory("all");
                    setFolder(f.name);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    folder === f.name
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {f.name}
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
            onDiscountChange={(line, type, value) =>
              setCart((prev) =>
                prev.map((l) => (sameLine(l, line) ? { ...l, discountType: type, discountValue: value } : l)),
              )
            }
            onTierChange={(line, tier) =>
              setCart((prev) => prev.map((l) => (sameLine(l, line) ? { ...l, priceTier: tier } : l)))
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
          if (imeiProduct) addScannedUnit(imeiProduct, unit);
          setImeiProduct(null);
        }}
      />
      <ServiceItemDialog
        product={serviceProduct}
        onOpenChange={(open) => !open && setServiceProduct(null)}
        onAdd={(product, target, amount) => {
          const line: CartLine = {
            product,
            unit: null,
            qty: 1,
            priceTier: "ritel",
            discountType: null,
            discountValue: 0,
            serviceTarget: target,
            serviceAmount: amount,
            serviceLineId: crypto.randomUUID(),
          };
          setCart((current) => [...current, line]);
          setServiceProduct(null);
          toast.success(`${product.name} ditambahkan ke keranjang`);
        }}
      />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        cart={cart}
        customer={customer}
        submitting={checkoutBusy}
        onConfirm={(method, amountPaid, dueDate) => void confirmCheckout(method, amountPaid, dueDate)}
      />
      <PlnTokenDialog
        transaction={receipt}
        itemIndex={plnTokenItemIndex}
        onOpenChange={(open) => !open && setPlnTokenItemIndex(null)}
        onSaved={(updated) => {
          setReceipt(updated);
          const next = updated.items.findIndex((item) => item.service_category === "pln" && !item.pln_token);
          setPlnTokenItemIndex(next >= 0 ? next : null);
        }}
      />
      <ReceiptDialog transaction={receipt} open={receipt !== null && plnTokenItemIndex === null} onOpenChange={(open) => !open && setReceipt(null)} />
    </AppShell>
  );
}
