import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { Category, CategoryPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => apiGet<Category[]>("/categories") });
}

/** Owner-facing folder manager: add, rename, delete (blocked while products remain). */
export default function CategoryManager({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const queryClient = useQueryClient();
  const categories = useCategories();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  const create = useMutation({
    mutationFn: (payload: CategoryPayload) => apiPost<Category>("/categories", payload),
    onSuccess: (created) => {
      refresh();
      setNewName("");
      toast.success(`Folder "${created.name}" ditambahkan`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menambah folder")),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch<Category>(`/categories/${id}`, { name }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success("Nama folder diperbarui");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal mengganti nama folder")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/categories/${id}`),
    onSuccess: () => {
      refresh();
      toast.success("Folder dihapus");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Gagal menghapus folder")),
  });

  const rows = categories.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg" data-testid="category-manager-dialog">
        <DialogHeader>
          <DialogTitle>Kelola Folder Produk</DialogTitle>
          <DialogDescription>
            Buat folder sesuai jenis barang di toko Anda — mis. CCTV, Sparepart, Parfum, Kartu Perdana. Stok produk di
            folder dihitung per jumlah; hanya handphone yang dilacak per IMEI.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="new-folder">Nama folder baru</Label>
            <Input
              id="new-folder"
              value={newName}
              maxLength={40}
              placeholder="cth. CCTV"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim().length >= 2 && !create.isPending) {
                  create.mutate({ name: newName.trim() });
                }
              }}
              data-testid="category-name-input"
            />
          </div>
          <Button
            disabled={newName.trim().length < 2 || create.isPending}
            data-testid="category-add-btn"
            onClick={() => create.mutate({ name: newName.trim() })}
          >
            <FolderPlus className="h-4 w-4" /> Tambah
          </Button>
        </div>

        <div className="divide-y rounded-lg border" data-testid="category-list">
          {rows.length === 0 && (
            <p className="p-4 text-center text-sm text-slate-400">
              Belum ada folder. Tambahkan folder pertama Anda di atas.
            </p>
          )}
          {rows.map((cat) => (
            <div key={cat.id} className="flex items-center gap-2 p-2.5" data-testid="category-row">
              {editing?.id === cat.id ? (
                <>
                  <Input
                    autoFocus
                    value={editName}
                    maxLength={40}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editName.trim().length >= 2) {
                        rename.mutate({ id: cat.id, name: editName.trim() });
                      }
                    }}
                    data-testid="category-rename-input"
                  />
                  <Button
                    size="sm"
                    disabled={editName.trim().length < 2 || rename.isPending}
                    data-testid="category-rename-save-btn"
                    onClick={() => rename.mutate({ id: cat.id, name: editName.trim() })}
                  >
                    Simpan
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    Batal
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800" data-testid="category-row-name">
                      {cat.name}
                    </p>
                    <p className="text-xs text-slate-400">{cat.product_count} produk</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="category-edit-btn"
                    onClick={() => {
                      setEditing(cat);
                      setEditName(cat.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Ganti Nama
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={remove.isPending}
                    data-testid="category-delete-btn"
                    onClick={() => remove.mutate(cat.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" data-testid="category-manager-close-btn" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
