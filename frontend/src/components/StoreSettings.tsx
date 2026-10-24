import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound, Pencil, Store as StoreIcon } from "lucide-react";
import { apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import type {
  CloneStorePayload,
  CloneStoreResult,
  ResetPasswordPayload,
  Store,
  StoreUpdatePayload,
  User,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Owner-issued password reset: no old password needed — the owner is already signed in. */
export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { user: me, logout } = useAuth();
  const isSelf = user?.id === me?.id;

  const reset = useMutation({
    mutationFn: (payload: ResetPasswordPayload) => apiPatch<User>(`/auth/users/${user?.id}/password`, payload),
    onSuccess: () => {
      toast.success(`Password ${user?.name} berhasil diatur ulang`);
      onOpenChange(false);
      if (isSelf) {
        // your own token stays valid, but the next login uses the new password
        toast.info("Password akun Anda berubah — gunakan password baru saat login berikutnya");
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal mengatur ulang password")),
  });

  function submit() {
    if (password.length < 6) {
      toast.error("Password minimal 6 karakter");
      return;
    }
    if (password !== confirm) {
      toast.error("Konfirmasi password tidak sama");
      return;
    }
    reset.mutate({ password });
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="user-reset-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#0284C7]" /> Atur Ulang Password
          </DialogTitle>
          <DialogDescription>
            Buat password baru untuk <span className="font-medium text-slate-700">{user?.name}</span> (
            {user?.email}). Password lama tidak diperlukan — beri tahu password baru ini ke yang bersangkutan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reset-password">Password Baru * (min. 6 karakter)</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              data-testid="reset-password-input"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reset-password-confirm">Ulangi Password Baru *</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !reset.isPending && submit()}
              placeholder="••••••••"
              data-testid="reset-password-confirm-input"
            />
          </div>
          {isSelf ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Anda sedang mengubah password akun sendiri. Sesi ini tetap aktif; gunakan password baru saat login
              berikutnya.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={reset.isPending} data-testid="reset-password-save-btn">
            {reset.isPending ? "Menyimpan…" : "Simpan Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shop identity card + editor. These three fields print on the receipt header. */
export function StoreProfileCard() {
  const { store, refreshSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", warranty: "", thanks: "" });
  const queryClient = useQueryClient();

  function openEditor() {
    setForm({
      name: store?.name ?? "",
      address: store?.address ?? "",
      phone: store?.phone ?? "",
      warranty: store?.receipt_warranty ?? "",
      thanks: store?.receipt_thanks ?? "",
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: (payload: StoreUpdatePayload) => apiPatch<Store>("/auth/store", payload),
    onSuccess: async () => {
      await refreshSession(); // header + receipt header read the store from the session
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Profil toko berhasil diperbarui");
      setOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal memperbarui profil toko")),
  });

  function submit() {
    if (form.name.trim().length < 2) {
      toast.error("Nama toko minimal 2 karakter");
      return;
    }
    save.mutate({
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      receipt_warranty: form.warranty.trim(),
      receipt_thanks: form.thanks.trim(),
    });
  }

  return (
    <>
      <Card data-testid="store-profile-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0284C7]">
              <StoreIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-heading truncate text-base font-bold" data-testid="store-profile-name">
                {store?.name}
              </p>
              <p className="truncate text-sm text-slate-500" data-testid="store-profile-detail">
                {store?.address || "Alamat belum diisi"}
                {store?.phone ? ` · WA ${store.phone}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Data ini tercetak di kepala struk pembayaran.</p>
              <p className="mt-0.5 truncate text-xs text-slate-400" data-testid="store-profile-footer-preview">
                Kaki struk: {store?.receipt_warranty || "-"} · {store?.receipt_thanks || "-"}
              </p>
            </div>
          </div>
          <Button variant="outline" data-testid="store-profile-edit-btn" onClick={openEditor}>
            <Pencil className="h-4 w-4" /> Edit Profil Toko
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="store-profile-dialog">
          <DialogHeader>
            <DialogTitle>Edit Profil Toko</DialogTitle>
            <DialogDescription>Nama, alamat, dan nomor WhatsApp yang tercetak di kepala struk.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="store-name">Nama Toko *</Label>
              <Input
                id="store-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="cth. Sinar Cell Bandung"
                data-testid="store-name-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-address">Alamat Toko</Label>
              <Input
                id="store-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="cth. Jl. Asia Afrika No. 5, Bandung"
                data-testid="store-address-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-phone">No. WhatsApp Toko</Label>
              <Input
                id="store-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="0812-3456-7890"
                data-testid="store-phone-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-warranty">Teks Garansi di Struk</Label>
              <Textarea
                id="store-warranty"
                rows={2}
                maxLength={200}
                value={form.warranty}
                onChange={(e) => setForm((f) => ({ ...f, warranty: e.target.value }))}
                placeholder="cth. Garansi resmi toko 7 hari (tukar unit bila ada cacat pabrik)."
                data-testid="store-warranty-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="store-thanks">Ucapan Terima Kasih di Struk</Label>
              <Input
                id="store-thanks"
                maxLength={120}
                value={form.thanks}
                onChange={(e) => setForm((f) => ({ ...f, thanks: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && !save.isPending && submit()}
                placeholder="cth. Terima kasih, silakan datang kembali!"
                data-testid="store-thanks-input"
              />
              <p className="text-[11px] text-slate-400">
                Kosongkan untuk memakai teks bawaan. Kedua teks ini tercetak di bagian bawah struk.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={submit} disabled={save.isPending} data-testid="store-profile-save-btn">
              {save.isPending ? "Menyimpan…" : "Simpan Profil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const EMPTY_CLONE_FORM: CloneStorePayload = {
  store_name: "",
  store_address: "",
  store_phone: "",
  name: "",
  email: "",
  password: "",
  current_password: "",
};

/** Creates a separate store seeded with a copy of this store's categories and products. */
export function CloneStoreCard() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CloneStorePayload>(EMPTY_CLONE_FORM);
  const set = (key: keyof CloneStorePayload) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const clone = useMutation({
    mutationFn: (payload: CloneStorePayload) => apiPost<CloneStoreResult>("/auth/stores/clone", payload),
    onSuccess: (result) => {
      toast.success(
        `Toko "${result.store.name}" dibuat: ${result.categories_copied} folder & ${result.products_copied} produk disalin. Login dengan ${result.owner.email}`,
      );
      setOpen(false);
      setForm(EMPTY_CLONE_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal membuat toko baru")),
  });

  function submit() {
    if (form.store_name.trim().length < 2 || form.name.trim().length < 2) {
      toast.error("Nama toko dan nama pemilik minimal 2 karakter");
      return;
    }
    if (!form.email.includes("@")) {
      toast.error("Email pemilik toko baru tidak valid");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password minimal 6 karakter");
      return;
    }
    if (!form.current_password) {
      toast.error("Masukkan password Anda saat ini untuk konfirmasi");
      return;
    }
    clone.mutate({ ...form, store_name: form.store_name.trim(), name: form.name.trim(), email: form.email.trim() });
  }

  return (
    <>
      <Card data-testid="clone-store-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#0284C7]">
              <Copy className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-heading text-base font-bold">Buat Toko Baru dari Toko Ini</p>
              <p className="text-sm text-slate-500">
                Folder dan produk disalin (stok mulai 0). Toko baru punya akun sendiri; perubahan di salah satu toko
                tidak memengaruhi toko lainnya. Transaksi dan riwayat tidak disalin.
              </p>
            </div>
          </div>
          <Button variant="outline" data-testid="clone-store-btn" onClick={() => setOpen(true)}>
            <Copy className="h-4 w-4" /> Buat Toko Baru
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="clone-store-dialog">
          <DialogHeader>
            <DialogTitle>Buat Toko Baru</DialogTitle>
            <DialogDescription>
              Anda tetap login di toko ini. Pemilik toko baru login dengan email dan password di bawah.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="clone-store-name">Nama Toko Baru *</Label>
              <Input id="clone-store-name" value={form.store_name} onChange={set("store_name")} data-testid="clone-store-name-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-store-address">Alamat Toko</Label>
              <Input id="clone-store-address" value={form.store_address} onChange={set("store_address")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-store-phone">No. WhatsApp Toko</Label>
              <Input id="clone-store-phone" value={form.store_phone} onChange={set("store_phone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-owner-name">Nama Pemilik Toko Baru *</Label>
              <Input id="clone-owner-name" value={form.name} onChange={set("name")} data-testid="clone-owner-name-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-owner-email">Email Login *</Label>
              <Input id="clone-owner-email" type="email" autoComplete="off" value={form.email} onChange={set("email")} data-testid="clone-owner-email-input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-owner-password">Password * (min. 6 karakter)</Label>
              <Input
                id="clone-owner-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={set("password")}
                data-testid="clone-owner-password-input"
              />
            </div>
            <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Label htmlFor="clone-confirm-password">Konfirmasi: Password Anda Saat Ini *</Label>
              <Input
                id="clone-confirm-password"
                type="password"
                autoComplete="current-password"
                value={form.current_password}
                onChange={set("current_password")}
                onKeyDown={(e) => e.key === "Enter" && !clone.isPending && submit()}
                data-testid="clone-confirm-password-input"
              />
              <p className="text-[11px] text-amber-800">
                Diperlukan demi keamanan karena seluruh katalog produk toko ini akan disalin. Maksimal 3 toko baru per hari.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={submit} disabled={clone.isPending} data-testid="clone-store-save-btn">
              {clone.isPending ? "Membuat…" : "Buat Toko"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}