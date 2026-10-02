import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import type { TodayAttendance } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function localTime(value: string | null | undefined, timezone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

export default function AttendancePanel() {
  const queryClient = useQueryClient();
  const today = useQuery({
    queryKey: ["attendance", "me", "today"],
    queryFn: () => apiGet<TodayAttendance>("/attendance/me/today"),
  });
  const row = today.data?.attendance;

  const action = useMutation({
    mutationFn: (kind: "check-in" | "check-out") => apiPost(`/attendance/${kind}`, {}),
    onSuccess: (_result, kind) => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
      toast.success(kind === "check-in" ? "Absen masuk tercatat" : "Absen pulang tercatat");
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Absen gagal disimpan")),
  });

  const state = !row ? "Belum absen masuk" : row.check_out_at ? "Shift selesai" : "Sedang bertugas";
  return (
    <Card className="border-slate-200 shadow-none" data-testid="attendance-panel">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Clock3 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Absensi Hari Ini · {state}</p>
            <p className="text-xs text-slate-500">
              Jam toko {today.data?.opening_time ?? "--:--"}–{today.data?.closing_time ?? "--:--"}
              {row ? ` · Masuk ${localTime(row.check_in_at, today.data?.timezone ?? "Asia/Jakarta")}${row.check_out_at ? ` · Pulang ${localTime(row.check_out_at, today.data?.timezone ?? "Asia/Jakarta")}` : ""}` : ""}
            </p>
          </div>
        </div>
        {!row ? (
          <Button size="sm" disabled={today.isLoading || action.isPending} onClick={() => action.mutate("check-in")} data-testid="attendance-check-in-btn">
            <ArrowDownToLine className="h-4 w-4" /> Absen Masuk
          </Button>
        ) : !row.check_out_at ? (
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate("check-out")} data-testid="attendance-check-out-btn">
            <ArrowUpFromLine className="h-4 w-4" /> Absen Pulang
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
