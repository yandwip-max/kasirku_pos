import { Routes, Route, Navigate } from "react-router-dom";
import { RequireAuth, RequirePermission } from "@/components/RequireAuth";
import LoginPage from "@/pages/LoginPage";
import PosPage from "@/pages/PosPage";
import ProductsPage from "@/pages/ProductsPage";
import TransactionsPage from "@/pages/TransactionsPage";
import DailyReportPage from "@/pages/DailyReportPage";
import ReportsPage from "@/pages/ReportsPage";
import UsersPage from "@/pages/UsersPage";
import ActivityLogPage from "@/pages/ActivityLogPage";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
// Pemilik-only screens are wrapped in RequirePermission — the backend enforces the
// same permissions, this just avoids rendering a screen that would 403.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <PosPage />
          </RequireAuth>
        }
      />
      <Route
        path="/transactions"
        element={
          <RequireAuth>
            <TransactionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/products"
        element={
          <RequirePermission action="product:write">
            <ProductsPage />
          </RequirePermission>
        }
      />
      <Route
        path="/reports/daily"
        element={
          <RequirePermission action="report:read">
            <DailyReportPage />
          </RequirePermission>
        }
      />
      <Route
        path="/reports"
        element={
          <RequirePermission action="report:read">
            <ReportsPage />
          </RequirePermission>
        }
      />
      <Route
        path="/users"
        element={
          <RequirePermission action="user:manage">
            <UsersPage />
          </RequirePermission>
        }
      />

      <Route
        path="/activity"
        element={
          <RequirePermission action="user:manage">
            <ActivityLogPage />
          </RequirePermission>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
