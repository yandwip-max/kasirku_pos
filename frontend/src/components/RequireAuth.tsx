import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-[#F8FAFC]" data-testid="auth-loading-splash">
      <Loader2 className="h-6 w-6 animate-spin text-[#0284C7]" />
    </div>
  );
}

/** Gate for any signed-in area. Unauthenticated visitors land on /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Gate for Pemilik-only areas (reports, stock, users). The backend enforces the same
 * permission — this only avoids showing a screen that would 403. */
export function RequirePermission({ action, children }: { action: string; children: ReactNode }) {
  const { user, loading, can } = useAuth();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(action)) return <Navigate to="/" replace />;
  return <>{children}</>;
}