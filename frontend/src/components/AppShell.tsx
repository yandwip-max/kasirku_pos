import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, History, Package, ShoppingCart, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "Kasir (POS)", icon: ShoppingCart, testid: "nav-pos-link" },
  { to: "/products", label: "Stok & Produk", icon: Package, testid: "nav-products-link" },
  { to: "/transactions", label: "Riwayat Transaksi", icon: History, testid: "nav-transactions-link" },
  { to: "/reports", label: "Laporan Penjualan", icon: BarChart3, testid: "nav-reports-link" },
];

function navClassName({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100",
    isActive ? "bg-sky-50 text-[#0369A1]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-[#F8FAFC] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-[4.5rem] max-w-[1440px] items-center gap-6 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0284C7] text-white">
              <Store className="h-5 w-5" />
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="font-heading text-base font-extrabold tracking-tight">KasirKu Cell &amp; Acc</p>
              <p className="text-xs text-slate-500">Sistem POS Handphone &amp; Aksesoris</p>
            </div>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ to, label, icon: Icon, testid }) => (
              <NavLink key={to} to={to} data-testid={testid} className={navClassName}>
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Badge
              variant="outline"
              className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 lg:inline-flex"
              data-testid="cashier-shift-badge"
            >
              Shift Aktif: Kasir Pagi
            </Badge>
            <span className="hidden items-center gap-2 text-sm text-slate-600 sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Status Kasir: Siap
            </span>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 md:hidden">
          {NAV_ITEMS.map(({ to, label, icon: Icon, testid }) => (
            <NavLink key={to} to={to} data-testid={testid} className={navClassName}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>{children}</main>
      <Toaster />
    </div>
  );
}