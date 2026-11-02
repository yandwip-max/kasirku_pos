import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { Supplier, SupplierPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: () => apiGet<Supplier[]>("/suppliers") });
}

const EMPTY: SupplierPayload = { name: "", phone: "", address: "" };

/** Owner-facing supplier master data: add, edit, delete (blocked while products use it). */
export default function SupplierManager({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState<SupplierPayload>(EMPTY);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  function reset() {
    setForm(EMPTY);
    setEditing(null);
  }

  const save = useMutation({
    mutationFn: (payload: SupplierPayload) =>
      editing ? apiPatch<Supplier>(`/suppliers/${editing.id}`, payload) : apiPost<Supplier>("/suppliers", payload),
    onSuccess: () => {
      refresh();
      toast.success(editing ? "Supplier diperbarui" : "Supplier ditambahkan");
      reset();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menyimpan supplier")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/suppliers/${id}`),
    onSuccess: () => {
      refresh();
      toast.success("Supplier dihapus");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menghapus supplier")),
  });

  const rows = suppliers.data ?? [];
  const valid = form.name.trim().length >= 2;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg" data-testid="supplier-manager-dialog">
        <DialogHeader>
          <DialogTitle>Kelola Supplier</DialogTitle>
          <DialogDescription>
            Tambahkan data supplier lebih dulu, lalu pilih saat menambah atau mengedit produk.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-name">Nama supplier *</Label>
            <Input
              id="supplier-name"
              value={form.name}
              maxLength={80}
              placeholder="cth. PT Maju Jaya"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              data-testid="supplier-name-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-phone">Telepon</Label>
              <Input
                id="supplier-phone"
                value={form.phone}
                maxLength={30}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                data-testid="supplier-phone-input"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="supplier-address">Alamat</Label>
              <Input
                id="supplier-address"
                value={form.address}
                maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                data-testid="supplier-address-input"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!valid || save.isPending}
              data-testid="supplier-save-btn"
              onClick={() => save.mutate({ name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim() })}
            >
              <Plus className="h-4 w-4" /> {editing ? "Simpan Perubahan" : "Tambah Supplier"}
            </Button>
            {editing && (
              <Button variant="outline" onClick={reset}>
                Batal
              </Button>
            )}
          </div>
        </div>

        <div className="divide-y rounded-lg border" data-testid="supplier-list">
          {rows.length === 0 && (
            <p className="p-4 text-center text-sm text-slate-400">Belum ada supplier. Tambahkan supplier pertama di atas.</p>
          )}
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-2 p-2.5" data-testid="supplier-row">
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                <p className="text-xs text-slate-400">
                  {[s.phone, s.address].filter(Boolean).join(" · ") || "Tanpa kontak"} · {s.product_count} produk
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(s);
                  setForm({ name: s.name, phone: s.phone, address: s.address });
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                disabled={remove.isPending}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
