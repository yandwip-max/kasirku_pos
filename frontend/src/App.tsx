import { Routes, Route, Navigate } from "react-router-dom";
import PosPage from "@/pages/PosPage";
import ProductsPage from "@/pages/ProductsPage";
import TransactionsPage from "@/pages/TransactionsPage";
import ReportsPage from "@/pages/ReportsPage";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PosPage />} />
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/transactions" element={<TransactionsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}