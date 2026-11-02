import { useQuery } from "@tanstack/react-query";
import { Boxes, Coins, Package, TrendingUp } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AssetSummary } from "@/lib/types";
import { formatRupiah } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function Kpi({ icon, label, value, testid }: { icon: React.ReactNode; label: string; value: string; testid: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[#0284C7]">{icon}</span>
          {label}
        </div>
        <div className="mt-3 font-mono text-2xl font-bold tracking-tight" data-testid={testid}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AssetsPage() {
  const query = useQuery({ queryKey: ["products", "assets"], queryFn: () => apiGet<AssetSummary>("/products/assets") });
  const data = query.data;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Aset</h1>
          <p className="text-sm text-slate-500">Nilai seluruh stok produk berdasarkan harga modal dan harga jual.</p>
        </div>

        {query.isError && <p className="text-sm text-rose-600">Gagal memuat data aset.</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<Coins className="h-4 w-4" />} label="Total Aset (Modal)" value={data ? formatRupiah(data.total_asset_value) : "…"} testid="asset-total-cost" />
          <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Potensi Nilai Jual" value={data ? formatRupiah(data.total_retail_value) : "…"} testid="asset-total-retail" />
          <Kpi icon={<Boxes className="h-4 w-4" />} label="Total Stok (pcs)" value={data ? String(data.total_stock) : "…"} testid="asset-total-stock" />
          <Kpi icon={<Package className="h-4 w-4" />} label="Jumlah Produk" value={data ? String(data.product_count) : "…"} testid="asset-product-count" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aset per Folder / Kategori</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Produk</TableHead>
                  <TableHead className="text-right">Stok (pcs)</TableHead>
                  <TableHead className="text-right">Aset (Modal)</TableHead>
                  <TableHead className="text-right">Nilai Jual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_category ?? []).map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.category}</TableCell>
                    <TableCell className="text-right">{row.product_count}</TableCell>
                    <TableCell className="text-right">{row.stock}</TableCell>
                    <TableCell className="text-right font-mono">{formatRupiah(row.asset_value)}</TableCell>
                    <TableCell className="text-right font-mono">{formatRupiah(row.retail_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aset per Produk</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Harga Modal</TableHead>
                  <TableHead className="text-right">Aset (Modal)</TableHead>
                  <TableHead className="text-right">Nilai Jual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.products ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.category}</TableCell>
                    <TableCell>{row.supplier_name || "-"}</TableCell>
                    <TableCell className="text-right">{row.stock}</TableCell>
                    <TableCell className="text-right font-mono">{formatRupiah(row.cost_price)}</TableCell>
                    <TableCell className="text-right font-mono">{formatRupiah(row.asset_value)}</TableCell>
                    <TableCell className="text-right font-mono">{formatRupiah(row.retail_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
