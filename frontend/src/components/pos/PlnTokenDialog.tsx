import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Transaction } from "@/lib/types";
import { apiErrorMessage } from "@/lib/apiError";
import { apiPatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PlnTokenDialog({
  transaction,
  itemIndex,
  onOpenChange,
  onSaved,
}: {
  transaction: Transaction | null;
  itemIndex: number | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (transaction: Transaction) => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const item = transaction && itemIndex !== null ? transaction.items[itemIndex] : null;
  useEffect(() => setToken(""), [transaction?.id, itemIndex]);
  const save = useMutation({
    mutationFn: () => apiPatch<Transaction>(`/transactions/${transaction?.id}/items/${itemIndex}/pln-token`, { token }),
    onSuccess: (updated) => {
      onSaved(updated);
      setToken("");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Token PLN tersimpan");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Gagal menyimpan token PLN")),
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pln-token-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Catat Token PLN</DialogTitle>
          <DialogDescription>
            {item?.product_name} · ID pelanggan {item?.service_target}. Catat token dari provider setelah top-up berhasil.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="pln-token">Nomor Token (20 digit)</Label>
          <Input
            id="pln-token"
            value={token}
            onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 20))}
            inputMode="numeric"
            autoComplete="off"
            className="h-12 font-mono text-xl tracking-widest"
            placeholder="00000000000000000000"
            data-testid="pln-token-input"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Nanti</Button>
          <Button
            type="button"
            disabled={token.length !== 20 || save.isPending}
            onClick={() => save.mutate()}
            data-testid="pln-token-save-btn"
          >
            {save.isPending ? "Menyimpan…" : "Simpan Token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
