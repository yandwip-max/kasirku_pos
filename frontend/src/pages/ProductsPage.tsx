import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderTree, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { Product, ProductPayload, ProductType, ProductUnit } from "@/lib/types";
import { formatDateTime, formatRupiah, formatThousands, parseRupiah } from "@/lib/format";
import AppShell from "@/components/AppShell";
import CategoryManager, { useCategories } from "@/components/CategoryManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const ACCESSORY_CATEGORIES = ["Aksesoris & Casing", "Charger & Kabel", "Audio / TWS", "Voucher & Pulsa", "Lainnya"];
const TYPE_LABELS: Record<ProductType, string> = {
  handphone: "Handphone",
  aksesoris: "Aksesoris",
  voucher: "Voucher Pulsa",
};

const TYPE_FILTERS = [
  { id: "", label: "Semua Tipe", testid: "product-filter-type-all" },
  { id: "handphone", label: "Handphone", testid: "product-filter-type-handphone" },
  { id: "aksesoris", label: "Aksesoris", testid: "product-filter-type-aksesoris" },
  { id: "voucher", label: "Voucher Pulsa", testid: "product-filter-type-voucher" },
] as const;

/** Money/quantity fields are digit-only text inputs: a native number input reads the
 * Indonesian thousand separator ("13.500") as the decimal 13.5, which the backend
 * rejects as a non-integer (422). Digits in, formatted display out. */
function NumberField({
  id,
  label,
  value,
  onChange,
  placeholder,
  testid,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (digits: string) => void;
  placeholder?: string;
  testid?: string;
  hint?: string;
}) {
  const digits = value.replace(/\D/g, "");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={digits ? formatThousands(Number(digits)) : ""}
        onChange={(e) => onChange(String(parseRupiah(e.target.value)))}
        placeholder={placeholder}
        data-testid={testid}
      />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

interface FormState {
  name: string;
  brand: string;
  type: ProductType;
  category: string;
  sku: string;
  cost_price: string;
  sell_price: string;
  wholesale_price: string;
  stock_qty: string;
  min_stock: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    brand: "",
    type: "aksesoris",
    category: ACCESSORY_CATEGORIES[0],
    sku: "",
    cost_price: "",
    sell_price: "",
    wholesale_price: "",
    stock_qty: "0",
    min_stock: "5",
  };
}

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    brand: p.brand,
    type: p.type,
    category: p.category,
    sku: p.sku,
    cost_price: String(p.cost_price ?? 0),
    sell_price: String(p.sell_price),
    wholesale_price: String(p.wholesale_price ?? 0),
    stock_qty: String(p.stock_qty),
    min_stock: String(p.min_stock),
  };
}

function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}) {
  const [form, setForm] = useState<FormState>(product ? productToForm(product) : emptyForm());
  const queryClient = useQueryClient();
  const folderNames = (useCategories().data ?? []).map((c) => c.name);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: (payload: ProductPayload) =>
      product ? apiPatch<Product>(`/products/${product.id}`, payload) : apiPost<Product>("/products", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(product ? "Produk berhasil diperbarui" : "Produk berhasil ditambahkan");
      onOpenChange(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menyimpan produk")),
  });

  function submit() {
    if (!form.name.trim()) {
      toast.error("Nama produk wajib diisi");
      return;
    }
    // parseRupiah keeps digits only, so every value below is a safe integer
    save.mutate({
      name: form.name.trim(),
      brand: form.brand.trim(),
      type: form.type,
      category: form.category,
      sku: form.sku.trim(),
      cost_price: parseRupiah(form.cost_price),
      sell_price: parseRupiah(form.sell_price),
      wholesale_price: form.type === "voucher" ? parseRupiah(form.wholesale_price) : 0,
      stock_qty: form.type === "handphone" ? 0 : parseRupiah(form.stock_qty),
      min_stock: parseRupiah(form.min_stock) || 5,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg" data-testid="product-form-dialog">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Produk" : "Tambah Produk Baru"}</DialogTitle>
          <DialogDescription>
            {product
              ? "Perbarui informasi dan harga produk."
              : "Daftarkan handphone baru (stok per unit IMEI) atau aksesoris (stok jumlah)."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Tipe Produk</Label>
              <Select
                value={form.type}
                disabled={product !== null}
                onValueChange={(value) => {
                  const type = value as ProductType;
                  setForm((f) => ({
                    ...f,
                    type,
                    category:
                      type === "handphone"
                        ? "Handphone"
                        : type === "voucher"
                          ? "Voucher & Pulsa"
                          : ACCESSORY_CATEGORIES[0],
                  }));
                }}
              >
                <SelectTrigger data-testid="product-type-select">
                  <SelectValue>{(value: string | null) => (value ? TYPE_LABELS[value as ProductType] : "Pilih tipe")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="handphone">Handphone (per IMEI)</SelectItem>
                  <SelectItem value="aksesoris">Aksesoris (jumlah)</SelectItem>
                  <SelectItem value="voucher">Voucher Pulsa (grosir &amp; ritel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Folder / Kategori</Label>
              <Select
                value={form.category}
                disabled={form.type === "handphone"}
                onValueChange={(value) => set("category", value)}
              >
                <SelectTrigger data-testid="product-category-select">
                  <SelectValue>{(value: string | null) => (value ? value : "Pilih folder")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {form.type === "handphone" ? (
                    <SelectItem value="Handphone">Handphone</SelectItem>
                  ) : (
                    // shop-defined folders first, then the built-in accessory groups
                    [...folderNames, ...ACCESSORY_CATEGORIES.filter((c) => !folderNames.includes(c))].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="product-name">Nama Produk *</Label>
            <Input
              id="product-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="cth. Samsung Galaxy A55 5G"
              data-testid="product-name-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="product-brand">Brand</Label>
              <Input id="product-brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="cth. Samsung" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="product-sku">SKU / Kode</Label>
              <Input id="product-sku" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="cth. HP-SGA55" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="product-cost"
              label="Harga Modal (Rp)"
              value={form.cost_price}
              onChange={(v) => set("cost_price", v)}
              placeholder="0"
              testid="product-cost-input"
            />
            <NumberField
              id="product-sell"
              label={form.type === "voucher" ? "Harga Jual Ritel (Rp)" : "Harga Jual (Rp)"}
              value={form.sell_price}
              onChange={(v) => set("sell_price", v)}
              placeholder="0"
              testid="product-sell-input"
            />
          </div>

          {form.type === "voucher" && (
            <NumberField
              id="product-wholesale"
              label="Harga Jual Grosir (Rp)"
              value={form.wholesale_price}
              onChange={(v) => set("wholesale_price", v)}
              placeholder="Kosongkan / 0 untuk ikut harga ritel"
              testid="product-wholesale-input"
              hint="Kasir memilih Ritel atau Grosir per item di keranjang saat transaksi."
            />
          )}

          {(form.type === "aksesoris" || form.type === "voucher") && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                id="product-stock"
                label="Jumlah Stok"
                value={form.stock_qty}
                onChange={(v) => set("stock_qty", v)}
                placeholder="0"
                testid="product-stock-input"
              />
              <NumberField
                id="product-min-stock"
                label="Batas Stok Menipis"
                value={form.min_stock}
                onChange={(v) => set("min_stock", v)}
                placeholder="5"
                testid="product-min-stock-input"
              />
            </div>
          )}

          {form.type === "handphone" && (
            <p className="rounded-lg bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
              Stok handphone dikelola per unit fisik. Setelah produk tersimpan, buka{" "}
              <span className="font-semibold">Kelola Unit</span> untuk menambahkan IMEI, warna, dan kapasitas tiap unit.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={save.isPending} data-testid="product-save-btn">
            {save.isPending ? "Menyimpan…" : "Simpan Produk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnitManagerDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [imei, setImei] = useState("");
  const [color, setColor] = useState("");
  const [capacity, setCapacity] = useState("");
  const [cost, setCost] = useState(product?.cost_price ? String(product.cost_price) : "");
  const [sell, setSell] = useState(product?.sell_price ? String(product.sell_price) : "");
  const queryClient = useQueryClient();

  const unitsQuery = useQuery({
    queryKey: ["units", { productId: product?.id }],
    queryFn: () => apiGet<ProductUnit[]>(`/products/${product?.id}/units`),
    enabled: product !== null,
  });
  const units = unitsQuery.data ?? [];

  const addUnit = useMutation({
    mutationFn: () =>
      apiPost<ProductUnit>(`/products/${product?.id}/units`, {
        imei: imei.trim(),
        color: color.trim(),
        capacity: capacity.trim(),
        cost_price: parseRupiah(cost),
        sell_price: parseRupiah(sell),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Stok unit IMEI berhasil ditambahkan");
      setImei("");
      setColor("");
      setCapacity("");
      setCost(product?.cost_price ? String(product.cost_price) : "");
      setSell(product?.sell_price ? String(product.sell_price) : "");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menambah unit")),
  });

  const removeUnit = useMutation({
    mutationFn: (unitId: string) => apiDelete<void>(`/products/${product?.id}/units/${unitId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Unit berhasil dihapus");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menghapus unit")),
  });

  function submitUnit() {
    if (!imei.trim()) {
      toast.error("Nomor IMEI wajib diisi");
      return;
    }
    addUnit.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl" data-testid="unit-manager-dialog">
        <DialogHeader>
          <DialogTitle>Kelola Unit — {product?.name}</DialogTitle>
          <DialogDescription>Setiap unit fisik dibedakan lewat nomor IMEI, warna, dan kapasitas.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2">
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="unit-imei">No. IMEI *</Label>
            <Input
              id="unit-imei"
              value={imei}
              onChange={(e) => setImei(e.target.value)}
              placeholder="cth. 354912000000001"
              data-testid="imei-input"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="unit-color">Warna</Label>
            <Input
              id="unit-color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="cth. Midnight Black"
              data-testid="imei-color-input"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="unit-capacity">Kapasitas</Label>
            <Input
              id="unit-capacity"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="cth. 256GB"
              data-testid="imei-capacity-input"
            />
          </div>
          <NumberField
            id="unit-cost"
            label="Harga Modal (Rp)"
            value={cost}
            onChange={setCost}
            placeholder="0"
            testid="imei-cost-input"
          />
          <NumberField
            id="unit-sell"
            label="Harga Jual (Rp)"
            value={sell}
            onChange={setSell}
            placeholder="0"
            testid="imei-sell-input"
          />
          <Button className="sm:col-span-2" onClick={submitUnit} disabled={addUnit.isPending} data-testid="imei-add-unit-btn">
            <Plus className="h-4 w-4" /> Tambah Unit
          </Button>
        </div>
        <p className="-mt-1 text-xs text-slate-400">
          Harga modal &amp; jual per unit terisi otomatis dari harga produk — ubah jika harga beli unit berbeda.
        </p>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. IMEI</TableHead>
                <TableHead>Warna</TableHead>
                <TableHead>Kapasitas</TableHead>
                <TableHead className="text-right">Harga Modal</TableHead>
                <TableHead className="text-right">Harga Jual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {unitsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="h-6 animate-pulse rounded bg-slate-100" />
                  </TableCell>
                </TableRow>
              )}
              {units.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell className="font-mono text-xs font-semibold">{unit.imei}</TableCell>
                  <TableCell className="text-sm">{unit.color || "-"}</TableCell>
                  <TableCell className="text-sm">{unit.capacity || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatRupiah(unit.cost_price || (product?.cost_price ?? 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">
                    {formatRupiah(unit.sell_price || (product?.sell_price ?? 0))}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        unit.status === "in_stock"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500",
                      )}
                    >
                      {unit.status === "in_stock" ? "Tersedia" : "Terjual"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {unit.status === "in_stock" && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        data-testid="imei-delete-unit-btn"
                        onClick={() => removeUnit.mutate(unit.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!unitsQuery.isLoading && units.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-slate-400">
                    Belum ada unit. Tambahkan unit IMEI pertama.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProductDialog({
  product,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="product-delete-dialog">
        <DialogHeader>
          <DialogTitle>Hapus Produk</DialogTitle>
          <DialogDescription>
            Yakin ingin menghapus "{product?.name}"? Seluruh unit IMEI-nya juga akan dihapus.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending} data-testid="product-delete-confirm-btn">
            {pending ? "Menghapus…" : "Ya, Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | ProductType>("");
  const [folderFilter, setFolderFilter] = useState("");
  const folders = useCategories().data ?? [];
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [lowStock, setLowStock] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formProduct, setFormProduct] = useState<Product | null>(null);
  const [unitProduct, setUnitProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const queryClient = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ["products", { search, typeFilter, lowStock, folderFilter }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (typeFilter) params.set("type", typeFilter);
      if (folderFilter) params.set("category", folderFilter);
      if (lowStock) params.set("low_stock", "true");
      return apiGet<Product[]>(`/products?${params.toString()}`);
    },
  });
  const products = productsQuery.data ?? [];

  const removeProduct = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produk berhasil dihapus");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menghapus produk")),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">Stok &amp; Produk</h1>
            <p className="text-sm text-slate-500">
              Handphone dilacak per unit IMEI — aksesoris per jumlah stok.
            </p>
          </div>
          <Button
            data-testid="product-add-modal-btn"
            className="active:scale-[0.98] transition-transform duration-100"
            onClick={() => {
              setFormProduct(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Tambah Produk
          </Button>
          <Button
            variant="outline"
            data-testid="manage-categories-btn"
            className="active:scale-[0.98] transition-transform duration-100"
            onClick={() => setCategoryManagerOpen(true)}
          >
            <FolderTree className="h-4 w-4" /> Kelola Folder
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, SKU, atau IMEI…"
                className="pl-9"
                data-testid="product-search-input"
              />
            </div>
            <div className="flex gap-1">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  data-testid={f.testid}
                  onClick={() => setTypeFilter(f.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-100 active:scale-[0.98]",
                    typeFilter === f.id
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-slate-600">
              <Checkbox checked={lowStock} onCheckedChange={(v) => setLowStock(v === true)} data-testid="product-low-stock-checkbox" />
              Hanya stok menipis
            </Label>

            {folders.length > 0 && (
              <div className="flex w-full flex-wrap items-center gap-1 border-t pt-2.5" data-testid="folder-filter-row">
                <span className="mr-1 text-xs font-medium text-slate-500">Folder:</span>
                <button
                  type="button"
                  data-testid="folder-filter-all"
                  onClick={() => setFolderFilter("")}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-100 active:scale-[0.98]",
                    folderFilter === ""
                      ? "border-sky-600 bg-[#0284C7] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  Semua Folder
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    data-testid="folder-filter-chip"
                    onClick={() => setFolderFilter(f.name)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-100 active:scale-[0.98]",
                      folderFilter === f.name
                        ? "border-sky-600 bg-[#0284C7] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {f.name} <span className="opacity-60">({f.product_count})</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Harga Jual</TableHead>
                  <TableHead>Stok</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsQuery.isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <div className="h-8 animate-pulse rounded bg-slate-100" />
                      </TableCell>
                    </TableRow>
                  ))}
                {products.map((p) => {
                  const low = p.stock < p.min_stock;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-slate-500">
                          {p.brand || "-"} · {p.sku || "tanpa SKU"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            p.type === "handphone"
                              ? "border-sky-200 bg-sky-50 text-sky-700"
                              : p.type === "voucher"
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-amber-200 bg-amber-50 text-amber-700",
                          )}
                        >
                          {TYPE_LABELS[p.type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{p.category}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold">
                        {formatRupiah(p.sell_price)}
                        {p.type === "voucher" && p.wholesale_price > 0 ? (
                          <span className="block text-[11px] font-normal text-violet-600" data-testid="product-row-wholesale">
                            Grosir {formatRupiah(p.wholesale_price)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            low
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700",
                          )}
                        >
                          {p.type === "handphone" ? `${p.stock} unit` : `${p.stock} pcs`}
                          {low ? " · menipis" : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {p.type === "handphone" && (
                            <Button variant="outline" size="sm" data-testid="unit-manage-btn" onClick={() => setUnitProduct(p)}>
                              Kelola Unit
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            data-testid="product-edit-btn"
                            onClick={() => {
                              setFormProduct(p);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            data-testid="product-delete-btn"
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!productsQuery.isLoading && products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      Produk tidak ditemukan.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ProductFormDialog key={formProduct?.id ?? "new"} open={formOpen} onOpenChange={setFormOpen} product={formProduct} />
      <CategoryManager open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} />
      <UnitManagerDialog
        key={unitProduct?.id ?? "none"}
        product={unitProduct}
        open={unitProduct !== null}
        onOpenChange={(open) => !open && setUnitProduct(null)}
      />
      <DeleteProductDialog
        product={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeProduct.mutate(deleteTarget.id)}
        pending={removeProduct.isPending}
      />
    </AppShell>
  );
}