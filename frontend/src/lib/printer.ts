/** Paper size for the receipt printer. 58mm is the common portable/bluetooth
 * thermal printer (Panda, Eppos, Bluebamboo); 80mm is the desktop POS printer. */
export type PaperSize = "58" | "80" | "a4";

export const PAPER_OPTIONS: { id: PaperSize; label: string; hint: string }[] = [
  { id: "58", label: "58 mm", hint: "Printer portable / bluetooth (struk kecil)" },
  { id: "80", label: "80 mm", hint: "Printer thermal meja (struk lebar)" },
  { id: "a4", label: "A4", hint: "Printer biasa (kertas HVS)" },
];

const STORAGE_KEY = "kasirku.paper-size";
const STYLE_ID = "receipt-page-size";

export function loadPaperSize(): PaperSize {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "58" || saved === "80" || saved === "a4" ? saved : "58";
}

/** @page cannot be written per-selector, so the page box is injected as its own rule. */
export function applyPaperSize(size: PaperSize): void {
  localStorage.setItem(STORAGE_KEY, size);
  document.body.dataset.paper = size;

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent =
    size === "a4" ? "@page { size: A4; margin: 10mm; }" : `@page { size: ${size}mm auto; margin: 0; }`;
}

function paperWidth(size: PaperSize): string {
  return size === "58" ? "56mm" : size === "80" ? "76mm" : "100mm";
}

/** Print the receipt through an off-screen iframe.
 * Printing the live page does not work: the receipt lives inside a Radix dialog that is
 * `position: fixed` + transformed, so the print box ends up off-paper (blank sheet).
 * Cloning the node into its own document gives the thermal printer exactly one page. */
export function printReceipt(size: PaperSize): void {
  const node = document.getElementById("receipt-print-area");
  if (!node) {
    window.print();
    return;
  }

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join("\n");
  const page = size === "a4" ? "@page{size:A4;margin:10mm}" : `@page{size:${size}mm auto;margin:0}`;
  const width = paperWidth(size);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-testid", "receipt-print-frame");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8">${styles}` +
      `<style>${page}` +
      `html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
      // the app stylesheet's @media print rules use !important, so the per-paper override must too
      `#receipt-print-area{position:static !important;width:${width} !important;max-width:${width} !important;` +
      `margin:0 !important;padding:2mm !important;border:none !important;box-shadow:none !important;visibility:visible !important}` +
      `#receipt-print-area *{visibility:visible !important}` +
      `</style></head><body data-paper="${size}">${node.outerHTML}</body></html>`,
  );
  doc.close();

  const run = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1500);
  };
  // give the cloned stylesheets a tick to apply, otherwise the paper comes out unstyled
  if (doc.readyState === "complete") setTimeout(run, 350);
  else frame.onload = () => setTimeout(run, 350);
}

/* ── Direct thermal printing (portable / bluetooth printers) ─────────────────
 * The browser print dialog cannot reach a bluetooth 58 mm printer on Android, so the
 * receipt is sent as ESC/POS instead: RawBT (an Android print bridge app) via intent,
 * or straight over Web Bluetooth when the printer exposes a BLE serial service. */

/* Minimal Web Bluetooth typings — the API is not in TypeScript's DOM lib yet. */
interface BleCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(data: BufferSource): Promise<void>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
}
interface BleService {
  getCharacteristics(): Promise<BleCharacteristic[]>;
}
interface BleServer {
  getPrimaryService(service: number | string): Promise<BleService>;
  disconnect(): void;
}
interface BleDevice {
  gatt?: { connect(): Promise<BleServer>; disconnect(): void };
}
interface BluetoothApi {
  requestDevice(options: {
    filters?: { services: (number | string)[] }[];
    optionalServices?: (number | string)[];
  }): Promise<BleDevice>;
}

function bluetoothApi(): BluetoothApi | null {
  return (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth ?? null;
}

export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

export function hasWebBluetooth(): boolean {
  return bluetoothApi() !== null;
}

/** Hand the plain-text receipt to the RawBT app, which owns the bluetooth pairing. */
export function printViaRawBT(text: string): void {
  const intent = `intent:${encodeURIComponent(text)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
  window.location.href = intent;
}

export const RAWBT_PLAY_URL = "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

// Serial-over-BLE services used by virtually every cheap 58 mm printer
const BLE_SERVICES = [0x18f0, 0xff00, 0xae30, 0xffe0];

async function writableCharacteristic(server: BleServer) {
  for (const service of BLE_SERVICES) {
    try {
      const svc = await server.getPrimaryService(service);
      for (const ch of await svc.getCharacteristics()) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
      }
    } catch {
      // service not present on this printer — try the next one
    }
  }
  return null;
}

/** Pair (user gesture required) and stream the ESC/POS bytes in BLE-sized chunks. */
export async function printViaBluetooth(bytes: Uint8Array): Promise<void> {
  const bluetooth = bluetoothApi();
  if (!bluetooth) throw new Error("Browser ini tidak mendukung Bluetooth langsung (pakai Chrome Android).");

  const device = await bluetooth.requestDevice({
    filters: BLE_SERVICES.map((s) => ({ services: [s] })),
    optionalServices: BLE_SERVICES,
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error("Gagal menyambung ke printer.");

  const characteristic = await writableCharacteristic(server);
  if (!characteristic) {
    device.gatt?.disconnect();
    throw new Error("Printer tersambung tapi tidak menerima data cetak. Coba mode RawBT.");
  }

  const CHUNK = 180; // larger writes overflow the buffer on most 58 mm controllers
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.slice(i, i + CHUNK);
    if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 12));
  }
  device.gatt?.disconnect();
}
