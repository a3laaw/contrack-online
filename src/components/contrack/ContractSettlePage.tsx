"use client";

/**
 * صفحة «تصفية وإغلاق العقد» — تحويل نافذة التصفية (SettleDialog / _settle_contract) إلى صفحة كاملة.
 * نفس الحسابات والتحققات وزر التأكيد حرفيًا — POST /api/contracts/[id]/settle بلا أي تغيير.
 * لا مسار جديد — تُعرض مكان شاشة العقد داخل ContractDetailView عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPost } from "./api";
import { errMessage } from "./contrack-types";
import type { ContractDetailResponse, ContractOverviewResponse } from "./contrack-types";
import { formatKWD } from "@/lib/format";

interface ContractSettlePageProps {
  contractId: number;
  contractNumber: string;
  onAuthError: () => void;
  /** إلغاء أو إتمام التصفية — يعود لشاشة العقد */
  onCancel: () => void;
}

/** صف قيمة/تسمية (كما في نافذة التصفية) — المبالغ LTR بخط الأرقام */
function SumRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-left font-mono font-bold tabular-nums ${tone || ""}`} dir="ltr">
        {value || "—"}
      </span>
    </div>
  );
}

export function ContractSettlePage({ contractId, contractNumber, onAuthError, onCancel }: ContractSettlePageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // نفس مفتاحا الاستعلام في شاشة العقد — بيانات مخزّنة تُعرض فورًا
  const detailQuery = useQuery<ContractDetailResponse>({
    queryKey: ["contract", contractId],
    queryFn: () => apiGet<ContractDetailResponse>(`/api/contracts/${contractId}`),
  });

  const overviewQuery = useQuery<ContractOverviewResponse>({
    queryKey: ["contract", contractId, "overview"],
    queryFn: () => apiGet<ContractOverviewResponse>(`/api/contracts/${contractId}/overview`),
  });
  const data = overviewQuery.data ?? null;

  const cur = detailQuery.data?.contract?.currency || "د.ك";

  // 401 ⇒ إعادة فحص الجلسة (ستظهر شاشة الدخول)
  React.useEffect(() => {
    const e = overviewQuery.error;
    if (e instanceof ApiError && e.status === 401) onAuthError();
  }, [overviewQuery.error, onAuthError]);

  const settleMutation = useMutation({
    mutationFn: () => apiPost<{ message: string }>(`/api/contracts/${contractId}/settle`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["contract", contractId] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["contract", contractId, "overview"] });
      toast({ title: "تم", description: res.message || "تم إغلاق العقد · تصفية كاملة ✅" });
      onCancel();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تصفية العقد", description: errMessage(e) });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>العملاء والعقود</span>
          <span aria-hidden="true">←</span>
          <span>العقود</span>
          <span aria-hidden="true">←</span>
          <span className="font-medium text-foreground" dir="ltr">
            {contractNumber}
          </span>
        </nav>
        <h1 className="mt-1 text-xl font-bold">تصفية وإغلاق العقد</h1>
        <p className="text-sm text-muted-foreground">تصفية العقد وإغلاقه نهائيًا؟</p>
      </header>

      {/* ===== ملخص التصفية ===== */}
      {!data ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> جارٍ الحساب…
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 p-4 md:p-6">
            <SumRow label="القيمة الحالية" value={`${formatKWD(data.currentValue)} ${cur}`} />
            <SumRow label="المحصّل" value={`${formatKWD(data.totalReceipts)} ${cur}`} />
            <SumRow
              label="المتبقي"
              value={`${formatKWD(data.remaining)} ${cur}`}
              tone={data.remaining > 0.001 ? "text-status-danger" : "text-status-done"}
            />
            <p className="text-xs text-muted-foreground">يمكنك إعادة فتحه لاحقًا من صفحة البيانات إذا لزم.</p>
            {data.subDues.count > 0 && (
              <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg p-2 text-xs font-medium text-status-warn">
                ⚠ تنبيه: توجد {data.subDues.count} دفعة باطن مستحقة غير مدفوعة بإجمالي {formatKWD(data.subDues.unpaid)} {cur} — إغلاق العقد لا يسقطها.
              </p>
            )}
            {data.remaining > 0.001 && (
              <p className="text-xs font-medium text-destructive">
                لا يمكن الإغلاق · ما زال عليه مبلغ متبقٍ: {formatKWD(data.remaining)} {cur}
              </p>
            )}
            {data.remaining <= 0.001 && data.settlement.stageRequired && !data.settlement.stagesComplete && (
              <p className="text-xs font-medium text-status-warn">
                التحصيل مكتمل لكن مسار المراحل لم يكتمل بعد.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onCancel} disabled={settleMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={
                settleMutation.isPending ||
                !data ||
                data.remaining > 0.001 ||
                (data.settlement.stageRequired && !data.settlement.stagesComplete)
              }
              onClick={() => settleMutation.mutate()}
            >
              {settleMutation.isPending ? "جارٍ التصفية…" : "✔ تأكيد التصفية والإغلاق"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
