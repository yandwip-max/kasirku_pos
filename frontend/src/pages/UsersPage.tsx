import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, UserPlus } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { CreateUserPayload, Role, User } from "@/lib/types";
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

export default function UsersPage() {
  const { user: me, store } = useAuth();
  const [open, setOpen] = useState(false);
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