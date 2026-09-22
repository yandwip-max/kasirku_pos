import type { CartLine } from "./types";

/** Price of a cart line: a handphone unit may carry its own IMEI-specific price. */
export function linePrice(line: CartLine): number {
  return line.unit && line.unit.sell_price > 0 ? line.unit.sell_price : line.product.sell_price;
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, line) => sum + linePrice(line) * line.qty, 0);
}