import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { ResetPasswordDialog } from "@/components/StoreSettings";
import { BackupCard } from "@/components/DataTools";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { CreateUserPayload, Role, UpdateUserPayload, User } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<Role, string> = { pemilik: "Pemilik", kasir: "Kasir" };

/** Rename an account so it matches how the shop refers to the person. The name is
 * what prints on receipts, so renaming yourself refreshes the session too. */
function RenameUserDialog({
  user,
  isSelf,
  onOpenChange,
}: {
  user: User | null;
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const queryClient = useQueryClient();
  const { refreshSession } = useAuth();

  const rename = useMutation({
    mutationFn: (payload: UpdateUserPayload) => apiPatch<User>(`/auth/users/${user?.id}`, payload),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      if (isSelf) await refreshSession(); // header + receipts use this name
      toast.success("Data akun berhasil diperbarui");
      onOpenChange(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal memperbarui data akun")),
  });

  function submit() {
    if (name.trim().length < 2) {
      toast.error("Nama minimal 2 karakter");
      return;
    }
    const nextEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nextEmail)) {
      toast.error("Format email tidak valid");
      return;
    }
    rename.mutate({ name: name.trim(), email: nextEmail });
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="user-rename-dialog">
        <DialogHeader>
          <DialogTitle>Edit Akun Pengguna</DialogTitle>
          <DialogDescription>
            Sesuaikan nama akun dengan sebutan di toko (mis. "Kasir Pagi", "Admin Cabang 2") — nama ini yang tercetak
            di struk. Email adalah alamat login sekaligus tujuan laporan mingguan otomatis.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rename-input">Nama Pengguna *</Label>
            <Input
              id="rename-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth. Kasir Pagi"
              data-testid="user-rename-input"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-input">Email Login *</Label>
            <Input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !rename.isPending && submit()}
              placeholder="nama@gmail.com"
              data-testid="user-email-input"
            />
            <p className="text-[11px] text-slate-400">
              {user?.role === "pemilik"
                ? "Pakai email aktif Anda: laporan mingguan toko dikirim ke alamat ini setiap Minggu 20.00 WIB."
                : "Email ini dipakai kasir untuk login."}{" "}
              Setelah diubah, login memakai email baru.
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Peran <span className="font-medium text-slate-700">{user ? ROLE_LABEL[user.role] : ""}</span> dan password
            tidak berubah.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={rename.isPending} data-testid="user-rename-save-btn">
            {rename.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { user: me, store } = useAuth();
  const [open, setOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "kasir" as Role });
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<User[]>("/auth/users"),
  });
  const users = usersQuery.data ?? [];

  const createUser = useMutation({
    mutationFn: (payload: CreateUserPayload) => apiPost<User>("/auth/users", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Pengguna berhasil ditambahkan");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "kasir" });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menambah pengguna")),
  });

  const toggleActive = useMutation({
    mutationFn: (userId: string) => apiPatch<User>(`/auth/users/${userId}/deactivate`, {}),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(updated.is_active ? "Akun diaktifkan kembali" : "Akun dinonaktifkan");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal mengubah status akun")),
  });

  function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Nama dan email wajib diisi");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password minimal 6 karakter");
      return;
    }
    createUser.mutate({ ...form, name: form.name.trim(), email: form.email.trim() });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1440px] space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight">Pengguna Toko</h1>
            <p className="text-sm text-slate-500">
              Akun yang bisa mengakses <span className="font-medium">{store?.name}</span>. Kasir tidak melihat harga
              modal, laba, maupun laporan.
            </p>
          </div>
          <Button
            data-testid="user-add-modal-btn"
            className="active:scale-[0.98] transition-transform duration-100"
            onClick={() => setOpen(true)}
          >
            <UserPlus className="h-4 w-4" /> Tambah Pengguna
          </Button>
        </div>

        <BackupCard />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersQuery.isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <div className="h-8 animate-pulse rounded bg-slate-100" />
                      </TableCell>
                    </TableRow>
                  ))}
                {users.map((u) => (
                  <TableRow key={u.id} data-testid="user-row">
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === me?.id ? <span className="ml-2 text-xs text-slate-400">(Anda)</span> : null}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{u.email}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          u.role === "pemilik"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-slate-200 bg-slate-50 text-slate-600",
                        )}
                      >
                        {u.role === "pemilik" ? <ShieldCheck className="h-3 w-3" /> : null}
                        {ROLE_LABEL[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          u.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-red-200 bg-red-50 text-red-700",
                        )}
                      >
                        {u.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">{formatDateTime(u.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="user-edit-name-btn"
                          onClick={() => setRenameTarget(u)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit Akun
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="user-reset-password-btn"
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound className="h-3.5 w-3.5" /> Password
                        </Button>
                        {u.id !== me?.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid="user-toggle-active-btn"
                            disabled={toggleActive.isPending}
                            onClick={() => toggleActive.mutate(u.id)}
                          >
                            {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!usersQuery.isLoading && users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      Belum ada pengguna lain.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <RenameUserDialog
        key={renameTarget?.id ?? "none"}
        user={renameTarget}
        isSelf={renameTarget?.id === me?.id}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      />

      <ResetPasswordDialog
        key={`reset-${resetTarget?.id ?? "none"}`}
        user={resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="user-form-dialog">
          <DialogHeader>
            <DialogTitle>Tambah Pengguna Toko</DialogTitle>
            <DialogDescription>Akun baru hanya bisa mengakses data toko ini.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="user-name">Nama *</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="cth. Siti Kasir Sore"
                data-testid="user-name-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-email">Email *</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="kasir2@toko.id"
                data-testid="user-email-input"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-password">Password * (min. 6 karakter)</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                data-testid="user-password-input"
              />
            </div>
            <div className="grid gap-2">
              <Label>Peran</Label>
              <Select value={form.role} onValueChange={(value) => setForm((f) => ({ ...f, role: value as Role }))}>
                <SelectTrigger data-testid="user-role-select">
                  <SelectValue>{(value: string | null) => (value ? ROLE_LABEL[value as Role] : "Pilih peran")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kasir">Kasir — hanya transaksi &amp; riwayat</SelectItem>
                  <SelectItem value="pemilik">Pemilik — akses penuh termasuk laporan</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={submit} disabled={createUser.isPending} data-testid="user-save-btn">
              {createUser.isPending ? "Menyimpan…" : "Simpan Pengguna"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}