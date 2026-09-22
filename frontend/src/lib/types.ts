// Hand-written mirrors of the backend Pydantic models (backend/models/*.py).
// Nothing infers across the Python boundary — keep these in sync in the same edit.

export type ProductType = "handphone" | "aksesoris";

export interface Product {
  id: string;
  name: string;
  brand: string;
  type: ProductType;
  category: string;
  sku: string;
  cost_price: number;
  sell_price: number;
  stock_qty: number;
  min_stock: number;
  is_active: boolean;
  created_at: string;
  /** computed: in-stock unit count for handphones, stock_qty for accessories */
  stock: number;
}

export interface ProductUnit {
  id: string;
  product_id: string;
  imei: string;
  color: string;
  capacity: string;
  /** per-unit prices; 0 = fall back to the product-level price */
  cost_price: number;
  sell_price: number;
  status: "in_stock" | "sold";
  created_at: string;
  sold_at: string | null;
  transaction_id: string | null;
}

export interface TransactionItem {
  product_id: string;
  product_name: string;
  unit_id: string | null;
  imei: string | null;
  color: string | null;
  capacity: string | null;
  qty: number;
  price: number;
  subtotal: number;
}

export interface Transaction {
  id: string;
  transaction_number: string;
  items: TransactionItem[];
  total: number;
  payment_method: "tunai" | "qris";
  amount_paid: number;
  change_amount: number;
  customer_name: string;
  customer_phone: string;
  cashier_name: string;
  created_at: string;
}

export interface CartLine {
  product: Product;
  unit: ProductUnit | null; // handphone: the specific IMEI unit sold
  qty: number;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (Asia/Jakarta)
  revenue: number;
  transactions: number;
}

export interface PaymentPoint {
  method: string; // tunai | qris
  count: number;
  revenue: number;
}

export interface TopProduct {
  name: string;
  qty: number;
  revenue: number;
}

export interface ReportSummary {
  days: number;
  total_revenue: number;
  transaction_count: number;
  phones_sold: number;
  avg_transaction: number;
  daily: DailyPoint[];
  payment_breakdown: PaymentPoint[];
  top_products: TopProduct[];
}

export interface ProductPayload {
  name: string;
  brand: string;
  type: ProductType;
  category: string;
  sku: string;
  cost_price: number;
  sell_price: number;
  stock_qty: number;
  min_stock: number;
}

export interface UnitPayload {
  imei: string;
  color: string;
  capacity: string;
  cost_price: number;
  sell_price: number;
}

export interface CheckoutPayload {
  items: { product_id: string; unit_id: string | null; qty: number }[];
  payment_method: "tunai" | "qris";
  amount_paid: number | null;
  customer_name: string;
  customer_phone: string;
  cashier_name: string;
}