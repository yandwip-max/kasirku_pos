import { ApiError, OfflineError } from "@/lib/api";

/** Extract a human-readable message from a failed api* call. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof OfflineError) {
    return "Server aplikasi tidak dapat dihubungi. Pastikan backend berjalan di port 8001 dan database tersedia.";
  }
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      return "Server aplikasi sedang bermasalah. Periksa backend di port 8001 dan koneksi database.";
    }
    const body = err.body as { detail?: unknown } | null;
    if (body && typeof body.detail === "string") return body.detail;
    if (body && Array.isArray(body.detail)) return "Data yang dikirim tidak valid";
  }
  return fallback;
}