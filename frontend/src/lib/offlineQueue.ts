/** IndexedDB queue for sales made while offline.
 *
 * A queued sale keeps the cart snapshot (for the local receipt), the checkout payload,
 * and a `client_ref` the backend uses to record a replay exactly once.
 */

import type { CartLine, CheckoutPayload } from "./types";

const DB_NAME = "kasirku-offline";
const DB_VERSION = 1;
const STORE = "pending_sales";

export interface PendingSale {
  client_ref: string;
  store_id: string;
  payload: CheckoutPayload;
  /** denormalised for the offline receipt + the pending list UI */
  total: number;
  item_count: number;
  lines: { name: string; imei: string | null; qty: number; price: number }[];
  created_at: string;
  /** set when the server rejected the replay (e.g. stock already sold) */
  error?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_ref" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export const QUEUE_CHANGED_EVENT = "kasirku:queue-changed";

/** Any page may enqueue a sale, so mutations broadcast — the header badge and the
 * sync hook listen and refresh immediately instead of waiting for a reload. */
function notifyQueueChanged(): void {
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export async function enqueueSale(sale: PendingSale): Promise<void> {
  await tx("readwrite", (store) => store.put(sale) as IDBRequest<IDBValidKey>);
  notifyQueueChanged();
}

export async function listPendingSales(storeId: string): Promise<PendingSale[]> {
  try {
    const all = await tx<PendingSale[]>("readonly", (store) => store.getAll() as IDBRequest<PendingSale[]>);
    return all
      .filter((sale) => sale.store_id === storeId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return []; // IndexedDB unavailable (private mode) — treat as "nothing queued"
  }
}

export async function removeSale(clientRef: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(clientRef) as unknown as IDBRequest<undefined>);
  notifyQueueChanged();
}

export async function markSaleError(sale: PendingSale, error: string): Promise<void> {
  await tx("readwrite", (store) => store.put({ ...sale, error }) as IDBRequest<IDBValidKey>);
  notifyQueueChanged();
}

export function newClientRef(): string {
  return crypto.randomUUID();
}

/** Build the on-screen receipt for a sale that has not reached the server yet. */
export function pendingLinesFromCart(cart: CartLine[], price: (line: CartLine) => number) {
  return cart.map((line) => ({
    name: line.product.name,
    imei: line.unit?.imei ?? null,
    qty: line.qty,
    price: price(line),
  }));
}