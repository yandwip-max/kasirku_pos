import { getToken } from "@/lib/api";

/** Download an authenticated file endpoint: fetch with the bearer token, save as a blob.
 * A plain <a href> cannot be used because the export routes require the Authorization header. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new Error(`gagal (${res.status})`);

  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
