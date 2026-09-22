import type { CartLine } from "./types";

/** Unit price of a cart line, before any discount.
 *  - handphone: the IMEI unit's own price, else the product price
 *  - voucher:   the picked tier (grosir falls back to retail when unset)
 *  - aksesoris: the product price
 */
export function linePrice(line: CartLine): number {
  if (line.unit && line.unit.sell_price > 0) return line.unit.sell_price;
  if (line.product.type === "voucher" && line.priceTier === "grosir") {
    return line.product.wholesale_price > 0 ? line.product.wholesale_price : line.product.sell_price;
  }
  return line.product.sell_price;
}

/** Line total before discount. */
export function lineGross(line: CartLine): number {
  return linePrice(line) * line.qty;
}

/** Discount in rupiah for a line. Mirrors the server's _resolve_discount() exactly. */
export function lineDiscount(line: CartLine): number {
  if (!line.discountType || line.discountValue <= 0) return 0;
  const gross = lineGross(line);
  if (line.discountType === "persen") {
    const pct = Math.min(line.discountValue, 100);
    return Math.floor((gross * pct) / 100);
  }
  return Math.min(line.discountValue, gross);
}

/** Line total after discount. */
export function lineSubtotal(line: CartLine): number {
  return lineGross(line) - lineDiscount(line);
}

export function cartGross(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + lineGross(line), 0);
}

export function cartDiscount(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + lineDiscount(line), 0);
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + lineSubtotal(line), 0);
}

/** True when the entered discount cannot be applied (over 100% or above the line total). */
export function isDiscountInvalid(line: CartLine): boolean {
  if (!line.discountType || line.discountValue <= 0) return false;
  if (line.discountType === "persen") return line.discountValue > 100;
  return line.discountValue > lineGross(line);
}