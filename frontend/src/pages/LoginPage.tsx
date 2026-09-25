import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Lock, Store as StoreIcon } from "lucide-react";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [busy, setBusy] = useState(false);
  // Inline banner in addition to the toast: on a phone the toast can be missed.
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [regForm, setRegForm] = useState({
    store_name: "",
    store_address: "",
    store_phone: "",
    name: "",
    email: "",
    password: "",
  });

  async function submitLogin() {
    setError("");
    if (!loginForm.email.trim() || !loginForm.password) {
      setError("Email dan password wajib diisi");
      toast.error("Email dan password wajib diisi");
      return;
    }
    setBusy(true);
    try {
      await login({ email: loginForm.email.trim(), password: loginForm.password });
      toast.success("Berhasil masuk");
      navigate("/", { replace: true });
    } catch (err) {
      const message = apiErrorMessage(err, "Gagal masuk. Periksa koneksi lalu coba lagi.");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister() {
    setError("");
    if (!regForm.store_name.trim() || !regForm.name.trim() || !regForm.email.trim()) {
      setError("Nama toko, nama Anda, dan email wajib diisi");
      toast.error("Nama toko, nama Anda, dan email wajib diisi");
      return;
    }
    if (regForm.password.length < 6) {
      setError("Password minimal 6 karakter");
      toast.error("Password minimal 6 karakter");
      return;
    }
    setBusy(true);
    try {
      await register({ ...regForm, email: regForm.email.trim(), store_name: regForm.store_name.trim() });
      toast.success("Toko berhasil dibuat. Selamat datang!");
      navigate("/", { replace: true });
    } catch (err) {
      const message = apiErrorMessage(err, "Gagal mendaftar. Periksa koneksi lalu coba lagi.");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function fillDemo() {
    setTab("login");
    setLoginForm({ email: "pemilik@demo.id", password: "demo1234" });
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — asymmetric, left-weighted */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0C4A6E] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{ background: "radial-gradient(120% 90% at 10% 10%, #0284C7 0%, transparent 60%)" }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <StoreIcon className="h-5 w-5" />
          </div>
          <p className="font-heading text-lg font-extrabold tracking-tight">KasirKu</p>
        </div>
        <div className="relative max-w-md space-y-4">
          <h1 className="font-heading text-4xl font-extrabold leading-tight tracking-tight">
            Kasir handphone &amp; aksesoris, siap dipakai banyak toko.
          </h1>
          <p className="text-sky-100/90">
            Stok per unit IMEI, pembayaran tunai &amp; QRIS, laporan harian lengkap dengan laba — dan tetap bisa
            bertransaksi saat internet mati.
          </p>
          <ul className="space-y-1.5 text-sm text-sky-100/80">
            <li>• Data tiap toko terpisah dan hanya bisa diakses penggunanya</li>
            <li>• Peran Pemilik &amp; Kasir dengan hak akses berbeda</li>
            <li>• Bisa dipasang di layar utama HP (Android &amp; iOS)</li>
          </ul>
        </div>
        <p className="relative text-xs text-sky-200/60">© {new Date().getFullYear()} KasirKu POS</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-[#F8FAFC] p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-2 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0284C7] text-white">
                <StoreIcon className="h-5 w-5" />
              </div>
              <p className="font-heading text-lg font-extrabold tracking-tight">KasirKu</p>
            </div>

            <Tabs value={tab} onValueChange={(value) => { setTab(value); setError(""); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" data-testid="login-tab">
                  Masuk
                </TabsTrigger>
                <TabsTrigger value="register" data-testid="register-tab">
                  Daftar Toko Baru
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5 space-y-4">
                <div>
                  <h2 className="font-heading text-xl font-bold">Masuk ke toko Anda</h2>
                  <p className="text-sm text-slate-500">Gunakan email dan password akun toko.</p>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="animate-in fade-in slide-in-from-top-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 duration-200"
                    data-testid="login-error-message"
                  >
                    {error}
                  </p>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="nama@toko.id"
                    data-testid="login-email-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && void submitLogin()}
                    placeholder="••••••••"
                    data-testid="login-password-input"
                  />
                </div>
                <Button
                  className="w-full active:scale-[0.98] transition-transform duration-100"
                  disabled={busy}
                  onClick={() => void submitLogin()}
                  data-testid="login-submit-btn"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Masuk
                </Button>
                <button
                  type="button"
                  onClick={fillDemo}
                  className="w-full rounded-lg border border-dashed border-slate-300 p-3 text-left text-xs leading-relaxed text-slate-500 transition-colors duration-100 hover:bg-slate-50"
                  data-testid="login-demo-fill-btn"
                >
                  <span className="font-semibold text-slate-700">Coba toko demo</span> — klik untuk mengisi otomatis:
                  <br />
                  pemilik@demo.id / demo1234 (Pemilik) · kasir@demo.id / demo1234 (Kasir)
                </button>
              </TabsContent>

              <TabsContent value="register" className="mt-5 space-y-4">
                <div>
                  <h2 className="font-heading text-xl font-bold">Daftarkan toko baru</h2>
                  <p className="text-sm text-slate-500">
                    Akun pertama otomatis jadi <span className="font-medium">Pemilik</span>. Data toko baru dimulai
                    kosong dan terpisah dari toko lain.
                  </p>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="animate-in fade-in slide-in-from-top-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 duration-200"
                    data-testid="register-error-message"
                  >
                    {error}
                  </p>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="reg-store">Nama Toko *</Label>
                  <Input
                    id="reg-store"
                    value={regForm.store_name}
                    onChange={(e) => setRegForm((f) => ({ ...f, store_name: e.target.value }))}
                    placeholder="cth. Sinar Cell Bandung"
                    data-testid="register-store-name-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reg-name">Nama Anda *</Label>
                  <Input
                    id="reg-name"
                    value={regForm.name}
                    onChange={(e) => setRegForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="cth. Budi Santoso"
                    data-testid="register-name-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reg-email">Email *</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    value={regForm.email}
                    onChange={(e) => setRegForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="nama@toko.id"
                    data-testid="register-email-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reg-password">Password * (min. 6 karakter)</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    value={regForm.password}
                    onChange={(e) => setRegForm((f) => ({ ...f, password: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && void submitRegister()}
                    placeholder="••••••••"
                    data-testid="register-password-input"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reg-phone">No. WhatsApp Toko (opsional)</Label>
                  <Input
                    id="reg-phone"
                    value={regForm.store_phone}
                    onChange={(e) => setRegForm((f) => ({ ...f, store_phone: e.target.value }))}
                    placeholder="0812-xxxx-xxxx"
                    data-testid="register-phone-input"
                  />
                </div>
                <Button
                  className="w-full active:scale-[0.98] transition-transform duration-100"
                  disabled={busy}
                  onClick={() => void submitRegister()}
                  data-testid="register-submit-btn"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <StoreIcon className="h-4 w-4" />}
                  Buat Toko &amp; Mulai
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}