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
