import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { ActivityCategory, ActivityPage as ActivityPageData } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PERIODS = [
  { id: "today", label: "Hari Ini" },
  { id: "7d", label: "7 Hari" },
  { id: "30d", label: "30 Hari" },
  { id: "all", label: "Semua" },
] as const;

const CATEGORIES: { id: "" | ActivityCategory; label: string }[] = [
  { id: "", label: "Semua Aktivitas" },
  { id: "harga", label: "Perubahan Harga" },
  { id: "stok", label: "Stok" },
  { id: "produk", label: "Produk" },
  { id: "akun", label: "Akun & Password" },
  { id: "toko", label: "Profil Toko" },
];

const CATEGORY_STYLE: Record<ActivityCategory, string> = {
  harga: "border-amber-200 bg-amber-50 text-amber-700",
  stok: "border-sky-200 bg-sky-50 text-sky-700",
  produk: "border-slate-200 bg-slate-50 text-slate-600",
  akun: "border-violet-200 bg-violet-50 text-violet-700",
  toko: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  harga: "Harga",
  stok: "Stok",
  produk: "Produk",
  akun: "Akun",
  toko: "Toko",
};

export default function ActivityLogPage() {
  const [period, setPeriod] = useState<string>("30d");
  const [category, setCategory] = useState<"" | ActivityCategory>("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);

  const logQuery = useQuery({
    queryKey: ["activity", { period, category, q, limit }],
    queryFn: () => {
      const params = new URLSearchParams({ period, limit: String(limit) });
      if (category) params.set("category", category);
      if (q.trim()) params.set("q", q.trim());
      return apiGet<ActivityPageData>(`/activity?${params.toString()}`);
    },
  });
  const rows = logQuery.data?.rows ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Riwayat Aktivitas</h1>
          <p className="text-sm text-slate-500">
            Catatan siapa mengubah harga, stok, produk, password, atau profil toko — beserta nilai sebelum &amp;
            sesudahnya.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={period === p.id ? "default" : "outline"}
                  data-testid={`activity-period-${p.id}-btn`}
                  onClick={() => setPeriod(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <Button
                  key={c.id || "all"}
                  size="sm"
                  variant={category === c.id ? "default" : "outline"}
                  data-testid={`activity-category-${c.id || "all"}-btn`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
            <div className="relative ml-auto min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Cari produk, pengguna, atau keterangan…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-testid="activity-search-input"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table data-testid="activity-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pelaku</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Objek</TableHead>
                  <TableHead>Perubahan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logQuery.isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <div className="h-8 animate-pulse rounded bg-slate-100" />
                      </TableCell>
                    </TableRow>
                  ))}
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="activity-row">
                    <TableCell className="whitespace-nowrap text-sm text-slate-500">
                      {formatDateTime(row.at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-medium">{row.actor_name}</span>
                      <span className="ml-1 text-xs text-slate-400">
                        ({row.actor_role === "pemilik" ? "Pemilik" : "Kasir"})
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(CATEGORY_STYLE[row.category])}>
                        {CATEGORY_LABEL[row.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{row.entity_name || "-"}</TableCell>
                    <TableCell className="text-sm text-slate-600">
                      <p>{row.summary}</p>
                      {row.changes.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                          {row.changes.map((c, idx) => (
                            <li key={`${row.id}-${idx}`}>
                              {c.field}: <span className="line-through">{c.before}</span>{" "}
                              <span className="font-semibold text-slate-700">→ {c.after}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!logQuery.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-slate-400">
                      <History className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                      Belum ada aktivitas pada periode ini.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {logQuery.data?.has_more && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              data-testid="activity-load-more-btn"
              onClick={() => setLimit((l) => l + 50)}
            >
              Tampilkan lebih banyak ({rows.length} dari {logQuery.data.total})
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
