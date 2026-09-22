const idr = new Intl.NumberFormat("id-ID");

export function formatRupiah(n: number): string {
  return `Rp ${idr.format(Math.round(n))}`;
}

export function formatThousands(n: number): string {
  return idr.format(n);
}

export function parseRupiah(s: string): number {
  const digits = s.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

/** Chart labels: "2026-01-05" -> "05 Jan" without timezone drift. */
export function formatDateShort(dateStr: string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(
    new Date(`${dateStr}T00:00:00`),
  );
}