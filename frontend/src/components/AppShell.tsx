import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  CloudOff,
  History,
  LogOut,
  Package,
  RefreshCw,
  ScrollText,
  ShoppingCart,
  Store,
  Users,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { formatRupiah } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Kasir (POS)", icon: ShoppingCart, testid: "nav-pos-link", action: "transaction:create" },
  { to: "/products", label: "Stok & Produk", icon: Package, testid: "nav-products-link", action: "product:write" },
  { to: "/transactions", label: "Riwayat", icon: History, testid: "nav-transactions-link", action: "transaction:read" },
  { to: "/reports/daily", label: "Laporan Harian", icon: CalendarDays, testid: "nav-daily-report-link", action: "report:read" },
  { to: "/reports", label: "Ringkasan", icon: BarChart3, testid: "nav-reports-link", action: "report:read" },
  { to: "/users", label: "Pengguna", icon: Users, testid: "nav-users-link", action: "user:manage" },
  { to: "/activity", label: "Aktivitas", icon: ScrollText, testid: "nav-activity-link", action: "user:manage" },
];

function navClassName({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100",
    isActive ? "bg-sky-50 text-[#0369A1]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, store, logout, can } = useAuth();
  const { online, pending, pendingCount, failedCount, syncing, flush, discard } = useOfflineSync();
  const [queueOpen, setQueueOpen] = useState(false);
  const navigate = useNavigate();

  const navItems = NAV_ITEMS.filter((item) => can(item.action));
  const queueTotal = pendingCount + failedCount;

  return (
    <div className="min-h-svh bg-[#F8FAFC] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-[4.5rem] max-w-[1440px] items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0284C7] text-white">
              <Store className="h-5 w-5" />
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="font-heading max-w-48 truncate text-base font-extrabold tracking-tight" data-testid="shell-store-name">
                {store?.name ?? "KasirKu"}
              </p>
              <p className="text-xs text-slate-500">Sistem POS Handphone &amp; Aksesoris</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 xl:flex">
            {navItems.map(({ to, label, icon: Icon, testid }) => (
              <NavLink key={to} to={to} end={to === "/"} data-testid={testid} className={navClassName}>
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* Connectivity + offline queue */}
            <button
              type="button"
              onClick={() => setQueueOpen(true)}
              data-testid="offline-status-btn"
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors duration-100",
                online
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
              )}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{online ? "Online" : "Mode Offline"}</span>
              {queueTotal > 0 && (
                <span
                  className="ml-0.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white"
                  data-testid="offline-queue-count"
                >
                  {queueTotal}
                </span>
              )}
            </button>

            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-semibold" data-testid="shell-user-name">
                {user?.name}
              </p>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 text-[10px]",
                  user?.role === "pemilik"
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-slate-50 text-slate-600",
                )}
                data-testid="shell-user-role"
              >
                {user?.role === "pemilik" ? "Pemilik" : "Kasir"}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="logout-btn"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 xl:hidden">
          {navItems.map(({ to, label, icon: Icon, testid }) => (
            <NavLink key={to} to={to} end={to === "/"} data-testid={`${testid}-mobile`} className={navClassName}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {!online && (
          <div
            className="bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-800"
            data-testid="offline-banner"
          >
            Sedang offline — transaksi tetap bisa disimpan dan akan otomatis terkirim saat internet kembali.
          </div>
        )}
      </header>

      <main>{children}</main>

      <Dialog open={queueOpen} onOpenChange={setQueueOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg" data-testid="offline-queue-dialog">
          <DialogHeader>
            <DialogTitle>Transaksi Offline</DialogTitle>
            <DialogDescription>
              {online
                ? "Perangkat online. Transaksi tertunda dikirim otomatis."
                : "Perangkat offline. Transaksi disimpan di HP ini dan dikirim saat internet kembali."}
            </DialogDescription>
          </DialogHeader>

          {pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400" data-testid="offline-queue-empty">
              Tidak ada transaksi tertunda.
            </p>
          ) : (
            <div className="space-y-2">
              {pending.map((sale) => (
                <div
                  key={sale.client_ref}
                  data-testid="offline-queue-item"
                  className={cn(
                    "rounded-lg border p-3",
                    sale.error ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold">{formatRupiah(sale.total)}</p>
                      <p className="truncate text-xs text-slate-500">
                        {sale.item_count} item · {sale.payload.payment_method === "tunai" ? "Tunai" : "QRIS"} ·{" "}
                        {new Date(sale.created_at).toLocaleString("id-ID")}
                      </p>
                      {sale.error ? (
                        <p className="mt-1 text-xs font-medium text-red-700">Gagal: {sale.error}</p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700">Menunggu dikirim ke server</p>
                      )}
                    </div>
                    {sale.error && (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="offline-queue-discard-btn"
                        onClick={() => void discard(sale.client_ref)}
                      >
                        Hapus
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            disabled={!online || syncing || pendingCount === 0}
            data-testid="offline-queue-sync-btn"
            onClick={() => void flush()}
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Menyinkronkan…" : "Sinkronkan Sekarang"}
          </Button>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  );
}