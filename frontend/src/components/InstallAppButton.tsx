import { useEffect, useState } from "react";
import { Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Chrome's install event. Not in TypeScript's DOM lib, so declared locally. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** "Pasang di layar utama" — uses Chrome's native prompt, falls back to iOS instructions. */
export default function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so our own button can trigger it later
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function handleClick() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setPrompt(null);
      return;
    }
    setHelpOpen(true); // iOS Safari and desktop browsers without the event
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-sky-200 bg-sky-50 text-sky-800 transition-transform duration-100 hover:bg-sky-100 active:scale-[0.98]"
        data-testid="install-app-btn"
        onClick={handleClick}
      >
        <Smartphone className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Pasang di HP</span>
      </Button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md" data-testid="install-help-dialog">
          <DialogHeader>
            <DialogTitle>Pasang KasirKu - Family App di Layar Utama</DialogTitle>
            <DialogDescription>
              Setelah dipasang, aplikasi terbuka layar penuh seperti aplikasi biasa dan tetap jalan saat internet mati.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm text-slate-600">
            {isIos() ? (
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  Ketuk ikon <Share className="inline h-3.5 w-3.5 align-text-bottom" /> <strong>Bagikan</strong> di bar
                  bawah Safari.
                </li>
                <li>
                  Pilih <strong>Tambahkan ke Layar Utama</strong> (Add to Home Screen).
                </li>
                <li>
                  Ketuk <strong>Tambah</strong> — ikon Family App muncul di layar utama.
                </li>
              </ol>
            ) : (
              <>
                <div>
                  <p className="font-semibold text-slate-800">Android (Chrome)</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5">
                    <li>Ketuk menu tiga titik di kanan atas.</li>
                    <li>
                      Pilih <strong>Tambahkan ke layar utama</strong> atau <strong>Instal aplikasi</strong>.
                    </li>
                    <li>Konfirmasi dengan <strong>Instal</strong>.</li>
                  </ol>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">Komputer (Chrome / Edge)</p>
                  <p className="mt-1">
                    Klik ikon instal di ujung kanan kolom alamat, lalu pilih <strong>Instal</strong>.
                  </p>
                </div>
              </>
            )}
            <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
              Tips: pasang di HP kasir agar bisa dipakai tanpa membuka browser, dan tetap melayani pembeli walau
              internet sedang mati.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
