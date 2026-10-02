import type { Transaction } from "@/lib/types";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { useAuth } from "@/lib/auth";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function Dotted() {
  return <div className="my-2 border-t border-dashed border-slate-300" />;
}

/** Thermal-style receipt. The wrapper id is targeted by the @media print rules in index.css.
 * `compact` tightens the layout for 58 mm portable/bluetooth printers. */
export default function ReceiptView({ transaction, compact = false }: { transaction: Transaction; compact?: boolean }) {
  const { store } = useAuth();
  const t = transaction;
  const discountTotal = t.discount_total ?? 0;
  const grossTotal = t.gross_total || t.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const paidLabel = t.payment_method === "tunai" ? "Bayar (Tunai)" : t.payment_method === "qris" ? "Bayar (QRIS)" : t.payment_method === "piutang" ? "Uang Muka" : "Bayar";

  return (
    <div
      id="receipt-print-area"
      className={
        compact
          ? "mx-auto w-full max-w-[220px] bg-white px-2 py-3 font-mono text-[9px] leading-snug text-slate-800"
          : "mx-auto w-full max-w-[320px] bg-white px-3 py-4 font-mono text-[11px] leading-relaxed text-slate-800"
      }
    >
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-wide">{store?.name ?? "KASIRKU"}</p>
        {store?.address ? <p className="text-[10px] text-slate-500">{store.address}</p> : null}
        {store?.phone ? <p className="text-[10px] text-slate-500">WA {store.phone}</p> : null}
      </div>
      <Dotted />
      <Row label="No. Struk" value={t.transaction_number} />
      <Row label="Tanggal" value={formatDateTime(t.created_at)} />
      <Row label="Kasir" value={t.cashier_name} />
      {t.customer_name ? <Row label="Pembeli" value={t.customer_name} /> : null}
      <Dotted />
      <div className="space-y-1.5">
        {t.items.map((item, idx) => (
          <div key={`${item.product_id}-${idx}`}>
            <p className="font-semibold">
              {item.product_name}
              {item.price_tier === "grosir" ? " (Grosir)" : ""}
            </p>
            {item.barcode ? (
              <p className="text-[10px] text-slate-500">Barcode {item.barcode}</p>
            ) : item.imei ? (
              <p className="text-[10px] text-slate-500">
                IMEI {item.imei} · {item.color} · {item.capacity}
              </p>
            ) : null}
            {item.service_category ? (
              <div className="mt-1 text-[10px] text-slate-600">
                <p>{item.provider} · {item.service_category === "pulsa" ? "Pulsa" : item.service_category === "ewallet" ? "E-Wallet" : "Listrik PLN"}</p>
                <p>Tujuan: <span className="font-semibold">{item.service_target}</span></p>
                {item.service_amount ? <p>Nominal layanan {formatRupiah(item.service_amount)}</p> : null}
                {item.pln_token ? (
                  <div className="mt-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-2 text-center text-emerald-900">
                    <p className="text-[9px] font-bold uppercase">Token PLN</p>
                    <p className="break-all font-mono text-xl font-extrabold leading-tight" data-testid="receipt-pln-token">{item.pln_token}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>
                {item.qty} x {formatRupiah(item.price)}
              </span>
              <span>{formatRupiah(item.price * item.qty)}</span>
            </div>
            {item.discount > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>
                  Diskon{item.discount_type === "persen" ? ` ${item.discount_value}%` : ""}
                </span>
                <span>−{formatRupiah(item.discount)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dotted />
      {discountTotal > 0 && (
        <>
          <Row label="Subtotal" value={formatRupiah(grossTotal)} />
          <Row label="Total Diskon" value={`−${formatRupiah(discountTotal)}`} />
        </>
      )}
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatRupiah(t.total)}</span>
      </div>
      <Row label={paidLabel} value={formatRupiah(t.amount_paid)} />
      {t.payment_method === "piutang" ? (
        <>
          <Row label="Sisa Piutang" value={formatRupiah(t.total - (t.amount_paid ?? 0))} />
          {t.piutang_paid_at ? <Row label="Tanggal Lunas" value={formatDateTime(t.piutang_paid_at)} /> : null}
        </>
      ) : (
        <Row label="Kembalian" value={formatRupiah(t.change_amount)} />
      )}
      <Dotted />
      <p className={compact ? "text-center text-[8px] leading-tight text-slate-500" : "text-center text-[10px] leading-snug text-slate-500"}>
        {store?.receipt_warranty}
        {store?.receipt_warranty && store?.receipt_thanks ? <br /> : null}
        {store?.receipt_thanks}
      </p>
    </div>
  );
}