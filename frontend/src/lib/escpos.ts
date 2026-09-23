import type { Store, Transaction } from "@/lib/types";
import { formatDateTime, formatRupiah } from "@/lib/format";

/** Characters per line: 32 on a 58 mm head, 48 on an 80 mm head (Font A). */
export function lineWidth(paper: "58" | "80" | "a4"): number {
  return paper === "58" ? 32 : 48;
}

function pad(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

function center(text: string, width: number): string {
  const trimmed = text.slice(0, width);
  const left = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return " ".repeat(left) + trimmed;
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Plain-text receipt, monospace-aligned to the paper width.
 * RawBT and ESC/POS both take this text as-is (RawBT applies the codepage itself). */
export function receiptText(t: Transaction, store: Store | null, paper: "58" | "80" | "a4"): string {
  const w = lineWidth(paper);
  const dash = "-".repeat(w);
  const out: string[] = [];

  out.push(center((store?.name ?? "KASIRKU").toUpperCase(), w));
  if (store?.address) wrap(store.address, w).forEach((l) => out.push(center(l, w)));
  if (store?.phone) out.push(center(`WA ${store.phone}`, w));
  out.push(dash);
  out.push(pad("No. Struk", t.transaction_number, w));
  out.push(pad("Tanggal", formatDateTime(t.created_at), w));
  out.push(pad("Kasir", t.cashier_name, w));
  if (t.customer_name) out.push(pad("Pembeli", t.customer_name, w));
  out.push(dash);

  for (const item of t.items) {
    const title = item.price_tier === "grosir" ? `${item.product_name} (Grosir)` : item.product_name;
    wrap(title, w).forEach((l) => out.push(l));
    if (item.imei) wrap(`IMEI ${item.imei} ${item.color} ${item.capacity}`.trim(), w).forEach((l) => out.push(l));
    out.push(pad(`${item.qty} x ${formatRupiah(item.price)}`, formatRupiah(item.price * item.qty), w));
    if (item.discount > 0) {
      const label = item.discount_type === "persen" ? `Diskon ${item.discount_value}%` : "Diskon";
      out.push(pad(label, `-${formatRupiah(item.discount)}`, w));
    }
  }

  out.push(dash);
  const discountTotal = t.discount_total ?? 0;
  const grossTotal = t.gross_total || t.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  if (discountTotal > 0) {
    out.push(pad("Subtotal", formatRupiah(grossTotal), w));
    out.push(pad("Total Diskon", `-${formatRupiah(discountTotal)}`, w));
  }
  out.push(pad("TOTAL", formatRupiah(t.total), w));
  out.push(pad(t.payment_method === "tunai" ? "Bayar (Tunai)" : "Bayar (QRIS)", formatRupiah(t.amount_paid), w));
  out.push(pad("Kembalian", formatRupiah(t.change_amount), w));
  out.push(dash);
  wrap("Garansi resmi toko 7 hari (tukar unit bila ada cacat pabrik).", w).forEach((l) => out.push(center(l, w)));
  out.push(center("Terima kasih telah berbelanja!", w));

  return out.join("\n");
}

const ESC = 0x1b;
const GS = 0x1d;

/** Raw ESC/POS bytes for a direct Bluetooth (BLE) write: init, print text, feed, cut. */
export function escposBytes(text: string): Uint8Array {
  const body = new TextEncoder().encode(`${text}\n`);
  const header = [ESC, 0x40, ESC, 0x61, 0x00]; // initialize + align left
  const footer = [0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]; // feed + partial cut
  const out = new Uint8Array(header.length + body.length + footer.length);
  out.set(header, 0);
  out.set(body, header.length);
  out.set(footer, header.length + body.length);
  return out;
}
