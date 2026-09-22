import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiPost, OfflineError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { listPendingSales, markSaleError, removeSale, QUEUE_CHANGED_EVENT, type PendingSale } from "@/lib/offlineQueue";
import type { Transaction } from "@/lib/types";

/** Tracks connectivity + the offline sale queue, and flushes it whenever the device
 * comes back online. Mounted once in AppShell so every page shares the same state. */
export function useOfflineSync() {
  const { store } = useAuth();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pending, setPending] = useState<PendingSale[]>([]);
  const [syncing, setSyncing] = useState(false);

  const storeId = store?.id ?? "";

  const refresh = useCallback(async () => {
    if (!storeId) return;
    setPending(await listPendingSales(storeId));
  }, [storeId]);

  const flush = useCallback(async () => {
    if (!storeId || !navigator.onLine) return;
    const queue = (await listPendingSales(storeId)).filter((sale) => !sale.error);
    if (queue.length === 0) {
      await refresh();
      return;
    }

    setSyncing(true);
    let synced = 0;
    let failed = 0;
    for (const sale of queue) {
      try {
        await apiPost<Transaction>("/transactions", sale.payload);
        await removeSale(sale.client_ref);
        synced += 1;
      } catch (err) {
        if (err instanceof OfflineError) break; // connection dropped again; keep the rest queued
        if (err instanceof ApiError) {
          const body = err.body as { detail?: unknown } | null;
          const detail = body && typeof body.detail === "string" ? body.detail : "Transaksi ditolak server";
          await markSaleError(sale, detail); // e.g. the IMEI was sold on another device
          failed += 1;
        } else {
          break;
        }
      }
    }
    setSyncing(false);
    await refresh();

    if (synced > 0) {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success(`${synced} transaksi offline berhasil disinkronkan`);
    }
    if (failed > 0) {
      toast.error(`${failed} transaksi offline gagal disinkronkan — cek daftar tertunda`);
    }
  }, [storeId, queryClient, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A sale queued from the POS page must show up in the header badge right away.
  useEffect(() => {
    const onQueueChanged = () => void refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
  }, [refresh]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush]);

  // Also try on mount (the app may have been closed while offline).
  useEffect(() => {
    if (navigator.onLine) void flush();
  }, [flush]);

  const discard = useCallback(
    async (clientRef: string) => {
      await removeSale(clientRef);
      await refresh();
      toast.success("Transaksi tertunda dihapus");
    },
    [refresh],
  );

  return {
    online,
    pending,
    pendingCount: pending.filter((p) => !p.error).length,
    failedCount: pending.filter((p) => p.error).length,
    syncing,
    flush,
    refresh,
    discard,
  };
}