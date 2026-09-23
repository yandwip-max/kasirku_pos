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
