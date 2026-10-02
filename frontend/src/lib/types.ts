// Hand-written mirrors of the backend Pydantic models (backend/models/*.py).
// Nothing infers across the Python boundary — keep these in sync in the same edit.

export type ProductType = "handphone" | "aksesoris" | "voucher" | "lainnya" | "non_fisik";
export type ServiceCategory = "pulsa" | "ewallet" | "pln";
export type Role = "pemilik" | "kasir";
export type DiscountType = "nominal" | "persen";
export type PriceTier = "ritel" | "grosir";
export type PaymentMethod = "tunai" | "qris" | "piutang";

export interface Store {
  id: string;
  name: string;
  address: string;
  phone: string;
  /** editable receipt footer */
  receipt_warranty: string;
  receipt_thanks: string;
  opening_time: string;
  closing_time: string;
  timezone: string;
  daily_report_enabled: boolean;
  created_at: string;
}

export interface StoreSchedulePayload {
  opening_time: string;
  closing_time: string;
  timezone: string;
  daily_report_enabled: boolean;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  user_name: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
}

export interface TodayAttendance {
  work_date: string;
  opening_time: string;
  closing_time: string;
  timezone: string;
  attendance: AttendanceRecord | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface SessionOut {
  token: string;
  user: User;
  store: Store;
}

export interface MeOut {
  user: User;
  store: Store;
  permissions: string[];
}

export interface RegisterPayload {
  store_name: string;
  store_address: string;
  store_phone: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export interface UpdateUserPayload {
  name: string;
  /** omit to keep the current login email */
  email?: string;
}

export interface ResetPasswordPayload {
  password: string;
}

export interface StoreUpdatePayload {
  name: string;
  address: string;
  phone: string;
  /** omit to keep the stored text; empty string restores the default wording */
  receipt_warranty?: string;
  receipt_thanks?: string;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  brand: string;
  type: ProductType;
  service_category: ServiceCategory | null;
  provider: string;
  denomination: number | null;
  category: string;
  sku: string;
  barcode: string;
  /** null when the signed-in role may not see harga modal (Kasir) */
  cost_price: number | null;
  sell_price: number; // harga ritel
  wholesale_price: number; // harga grosir (voucher); 0 = ikut harga ritel
  stock_qty: number;
  min_stock: number;
  is_active: boolean;
   created_at: string;
   /** when true, this product is serialized by IMEI/barcode per unit (handphones always are) */
   track_imei: boolean;
   /** computed: in-stock unit count for handphones, stock_qty for accessories */
   stock: number;
 }

export interface ProductUnit {
  id: string;
  store_id: string;
  product_id: string;
  imei: string;
  barcode: string | null;
  color: string;
  capacity: string;
  /** per-unit prices; 0 = fall back to the product-level price, null = masked for Kasir */
  cost_price: number | null;
  sell_price: number;
  status: "in_stock" | "sold";
  created_at: string;
  sold_at: string | null;
  transaction_id: string | null;
}

export interface ProductScanResult {
  product: Product;
  unit: ProductUnit | null;
}

export interface TransactionItem {
  product_id: string;
  product_name: string;
  unit_id: string | null;
  imei: string | null;
  barcode: string | null;
  color: string | null;
  capacity: string | null;
  service_category?: ServiceCategory | null;
  provider?: string | null;
  service_target?: string | null;
  service_amount?: number | null;
  pln_token?: string | null;
  qty: number;
  price: number; // unit price BEFORE discount
  price_tier: PriceTier;
  /** harga modal snapshot; null when masked for Kasir */
  cost: number | null;
  discount_type: DiscountType | null;
  discount_value: number;
  discount: number; // resolved rupiah taken off this line
  subtotal: number; // qty * price - discount
}

export interface Transaction {
  id: string;
  store_id: string;
  transaction_number: string;
  items: TransactionItem[];
  gross_total: number;
  discount_total: number;
  total: number;
  /** null when masked for Kasir */
  profit: number | null;
  payment_method: PaymentMethod;
  amount_paid: number;
  change_amount: number;
  customer_name: string;
  customer_phone: string;
  cashier_name: string;
  client_ref: string | null;
  created_at: string;
  due_date: string | null;
  piutang_status: "unpaid" | "paid" | null;
  piutang_paid_at: string | null;
  /** void/retur bookkeeping — legacy rows are "selesai" */
  status: "selesai" | "void";
  void_type: "void" | "retur" | null;
  void_reason: string;
  voided_by: string;
  voided_at: string | null;
}

export interface CartLine {
  product: Product;
  unit: ProductUnit | null; // handphone: the specific IMEI unit sold
  qty: number;
  /** voucher only: which price tier this line is sold at */
  priceTier: PriceTier;
  discountType: DiscountType | null;
  discountValue: number; // rupiah for "nominal", percent for "persen"
  serviceTarget?: string | null;
  serviceAmount?: number | null;
  serviceLineId?: string;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD (Asia/Jakarta)
  revenue: number;
  transactions: number;
}

export interface PaymentPoint {
  method: string; // tunai | qris | piutang
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
  /** HPP — harga modal barang yang terjual */
  total_cogs: number;
  total_profit: number;
  transaction_count: number;
  phones_sold: number;
  avg_transaction: number;
  piutang_paid: number;
  piutang_unpaid: number;
  daily: DailyPoint[];
  payment_breakdown: PaymentPoint[];
  top_products: TopProduct[];
}

export interface DailyRow {
  date: string;
  revenue: number;
  /** HPP hari itu */
  cogs: number;
  profit: number;
  transactions: number;
  items_sold: number;
  phones_sold: number;
  cash: number;
  qris: number;
  piutang: number;
  piutang_paid: number;
  piutang_unpaid: number;
  margin_percent: number;
}

export interface DailyReport {
  days: number;
  rows: DailyRow[];
  total_revenue: number;
  total_cogs: number;
  total_profit: number;
  total_transactions: number;
  best_day: string | null;
}

export interface ProductPayload {
  name: string;
  brand: string;
  type: ProductType;
  service_category: ServiceCategory | null;
  provider: string;
  denomination: number | null;
  category: string;
  sku: string;
  barcode: string;
  cost_price: number;
  sell_price: number;
  wholesale_price: number;
  stock_qty: number;
  min_stock: number;
  track_imei: boolean;
}

export interface UnitPayload {
  imei: string;
  barcode?: string;
  color: string;
  capacity: string;
  cost_price: number;
  sell_price: number;
}

export interface CheckoutPayload {
  items: {
    product_id: string;
    unit_id: string | null;
    qty: number;
    price_tier: PriceTier;
    discount_type: DiscountType | null;
    discount_value: number;
    service_target?: string | null;
    service_amount?: number | null;
  }[];
  payment_method: PaymentMethod;
  amount_paid: number | null;
  customer_name: string;
  customer_phone: string;
  /** set for sales queued offline so a replay is recorded exactly once */
  client_ref?: string;
  offline_created_at?: string;
  due_date?: string | null;
}
/* ── Riwayat Aktivitas (audit trail) — mirrors backend/models/audit.py ── */

export type ActivityCategory = "harga" | "stok" | "produk" | "akun" | "toko";

export interface ActivityChange {
  field: string;
  before: string;
  after: string;
}

export interface ActivityLog {
  id: string;
  at: string;
  actor_name: string;
  actor_role: Role;
  action: string;
  category: ActivityCategory;
  entity_name: string;
  summary: string;
  changes: ActivityChange[];
}

export interface ActivityPage {
  rows: ActivityLog[];
  total: number;
  has_more: boolean;
  next_skip: number | null;
}

/* ── Void / Retur transaksi & Backup data ── */

export interface VoidPayload {
  void_type: "void" | "retur";
  reason: string;
}

/* ── Folder produk (kategori buatan toko) ── */

export interface Category {
  id: string;
  name: string;
  product_count: number;
  created_at: string;
}

export interface CategoryPayload {
  name: string;
}

/* ── Laporan transaksi per rentang tanggal ── */

export interface TransactionRangeReport {
  start: string;
  end: string;
  transaction_count: number;
  void_count: number;
  total_revenue: number;
  total_cogs: number;
  total_profit: number;
  total_discount: number;
  items_sold: number;
  cash_total: number;
  qris_total: number;
  piutang_total: number;
  piutang_paid: number;
  piutang_unpaid: number;
}

/* ── Laporan Absensi (owner-only) ── */

export interface AttendanceEmployeeSummary {
  user_id: string;
  user_name: string;
  work_days: number;
  complete_days: number;
  avg_duration_minutes: number | null;
}

export interface AttendanceReport {
  period_days: number;
  date_from: string;
  date_to: string;
  total_records: number;
  employees: AttendanceEmployeeSummary[];
}
