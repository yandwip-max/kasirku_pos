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

/** Thermal-style receipt. The wrapper id is targeted by the @media print rules in index.css. */
export default function ReceiptView({ transaction }: { transaction: Transaction }) {
  const { store } = useAuth();
  const t = transaction;
  return (
    <div
      id="receipt-print-area"
      className="mx-auto w-full max-w-[320px] bg-white px-3 py-4 font-mono text-[11px] leading-relaxed text-slate-800"
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
            <p className="font-semibold">{item.product_name}</p>
            {item.imei ? (
              <p className="text-[10px] text-slate-500">
                IMEI {item.imei} · {item.color} · {item.capacity}
              </p>
            ) : null}
            <div className="flex justify-between">
              <span>
                {item.qty} x {formatRupiah(item.price)}
              </span>
              <span>{formatRupiah(item.subtotal)}</span>
            </div>
          </div>
        ))}
      </div>
      <Dotted />
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatRupiah(t.total)}</span>
      </div>
      <Row label={t.payment_method === "tunai" ? "Bayar (Tunai)" : "Bayar (QRIS)"} value={formatRupiah(t.amount_paid)} />
      <Row label="Kembalian" value={formatRupiah(t.change_amount)} />
      <Dotted />
      <p className="text-center text-[10px] leading-snug text-slate-500">
        Garansi resmi toko 7 hari (tukar unit bila ada cacat pabrik).
        <br />
        Terima kasih telah berbelanja!
      </p>
    </div>
  );
}