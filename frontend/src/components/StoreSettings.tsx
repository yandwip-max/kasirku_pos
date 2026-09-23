import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Pencil, Store as StoreIcon } from "lucide-react";
import { apiPatch } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import type { ResetPasswordPayload, Store, StoreUpdatePayload, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [form, setForm] = useState({ name: "", address: "", phone: "" });
  const queryClient = useQueryClient();

  function openEditor() {
    setForm({ name: store?.name ?? "", address: store?.address ?? "", phone: store?.phone ?? "" });
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
    save.mutate({ name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim() });
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
                onKeyDown={(e) => e.key === "Enter" && !save.isPending && submit()}
                placeholder="0812-3456-7890"
                data-testid="store-phone-input"
              />
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