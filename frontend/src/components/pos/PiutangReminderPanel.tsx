import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { Transaction } from "@/lib/types";
import { formatRupiah, parseRupiah, formatThousands } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function PiutangReminderPanel() {
  const queryClient = useQueryClient();
  const [payDialogTrx, setPayDialogTrx] = useState<Transaction | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [payAmount, setPayAmount] = useState<number>(0);

  const { data: unpaid = [] } = useQuery({
    queryKey: ["piutang", "unpaid"],
    queryFn: () => apiGet<Transaction[]>("/transactions?piutang_status=unpaid&period=all"),
  });

  const settleMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      return apiPost<Transaction>(`/transactions/${id}/settle`, { amount });
    },
    onSuccess: (data) => {
      toast.success(`Berhasil membayar piutang ${data.transaction_number}`);
      queryClient.invalidateQueries({ queryKey: ["piutang"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setPayDialogTrx(null);
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Gagal melunasi piutang"));
    }
  });

  const totalRemaining = unpaid.reduce(
    (sum, trx) => sum + Math.max(0, trx.total - trx.amount_paid),
    0,
  );

  if (unpaid.length === 0) return null;

  const now = new Date();
  
  // Sort by due date (soonest first)
  const sorted = [...unpaid].sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return da - db;
  });
  return (
    <>
      <button
        type="button"
        data-testid="piutang-reminder-toggle"
        onClick={() => setListOpen(true)}
        className="mb-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 transition-colors hover:bg-amber-100"
      >
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-semibold">Piutang belum lunas</span>
        <Badge variant="outline" className="border-amber-300 bg-white text-amber-800">{unpaid.length}</Badge>
        <span className="ml-auto truncate text-xs text-amber-800">Sisa {formatRupiah(totalRemaining)}</span>
        <span className="shrink-0 text-xs font-semibold">Lihat</span>
      </button>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
              Reminder Piutang Belum Lunas ({unpaid.length})
            </DialogTitle>
            <DialogDescription>Total sisa tagihan {formatRupiah(totalRemaining)}.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60svh] space-y-2 overflow-y-auto">
          {sorted.map(trx => {
            const dueDate = trx.due_date ? new Date(trx.due_date) : null;
            const isLate = dueDate && dueDate < now;
            const sisa = trx.total - trx.amount_paid;
            
            return (
              <div key={trx.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{trx.customer_name || "Tanpa Nama"}</p>
                    <p className="text-xs text-slate-500">{trx.transaction_number}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <Badge variant={isLate ? "destructive" : "outline"} className={!isLate ? "border-amber-300 text-amber-700" : ""}>
                      {isLate ? "Jatuh Tempo" : "Belum Lunas"}
                    </Badge>
                    <p className="mt-1 font-mono text-sm font-bold text-red-600">{formatRupiah(sisa)}</p>
                  </div>
                  <Button 
                    size="sm" 
                    className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      setListOpen(false);
                      setPayDialogTrx(trx);
                      setPayAmount(sisa);
                    }}
                  >
                    Bayar
                  </Button>
                </div>
              </div>
            );
          })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payDialogTrx} onOpenChange={(open) => !open && setPayDialogTrx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bayar Piutang</DialogTitle>
            <DialogDescription>
              {payDialogTrx?.customer_name} — {payDialogTrx?.transaction_number}
            </DialogDescription>
          </DialogHeader>

          {payDialogTrx && (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm text-slate-600">Total Transaksi: <span className="font-mono font-medium text-slate-900">{formatRupiah(payDialogTrx.total)}</span></p>
                <p className="text-sm text-slate-600">Sudah Dibayar: <span className="font-mono font-medium text-slate-900">{formatRupiah(payDialogTrx.amount_paid)}</span></p>
                <p className="text-sm font-semibold text-slate-800 mt-1 pt-1 border-t">
                  Sisa Tagihan: <span className="font-mono text-red-600">{formatRupiah(payDialogTrx.total - payDialogTrx.amount_paid)}</span>
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Jumlah Dibayar (Rp)</label>
                <Input
                  value={payAmount ? formatThousands(payAmount) : ""}
                  onChange={(e) => setPayAmount(parseRupiah(e.target.value))}
                  inputMode="numeric"
                  className="mt-1 font-mono text-lg font-bold"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPayDialogTrx(null)}>Batal</Button>
                <Button 
                  disabled={!payAmount || settleMutation.isPending} 
                  onClick={() => settleMutation.mutate({ id: payDialogTrx.id, amount: payAmount })}
                >
                  {settleMutation.isPending ? "Memproses..." : "Konfirmasi Pembayaran"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
