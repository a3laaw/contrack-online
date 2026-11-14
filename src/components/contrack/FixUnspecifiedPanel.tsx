"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api, apiGet } from "./api";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";

/**
 * G5 — إصلاح العقود ذات النوع «غير محدد»: تحليل (قراءة فقط) ثم قرارات صريحة
 * وتنفيذ مدير بحماية مزدوجة — إعادة بناء مراحل عقد عليه تقدّم فعلي تحتاج إقرارًا صريحًا.
 */

interface FixRow {
  contractId: number;
  contractNumber: string;
  customerName: string;
  contractName: string;
  amount: number;
  suggestedType: string;
  source: string;
  evidence: string;
  stagesState: string;
  receiptsState: string;
  risky: boolean;
  riskReasons: string;
  defaultAction: string;
}

type Decision = "skip" | "type_only" | "type_stages";

const DECISION_LABEL: Record<Decision, string> = {
  skip: "تخطي",
  type_only: "تحديث النوع فقط",
  type_stages: "النوع + إعادة بناء المراحل",
};

export function FixUnspecifiedPanel() {
  const qc = useQueryClient();
  const [rows, setRows] = React.useState<FixRow[] | null>(null);
  const [decisions, setDecisions] = React.useState<Record<number, { typeName: string; action: Decision }>>({});
  const [allowDestructive, setAllowDestructive] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ problems: string[]; log: string[]; typeUpdated: number; skipped: number } | null>(null);

  const typesQuery = useQuery({ queryKey: ["contract-types"], queryFn: api.contractTypes });
  const types = typesQuery.data ?? [];

  const analyze = React.useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiGet<{ rows: FixRow[] }>("/api/contracts/fix-unspecified");
      setRows(res.rows);
      const init: Record<number, { typeName: string; action: Decision }> = {};
      for (const r of res.rows) {
        init[r.contractId] = { typeName: r.suggestedType, action: (r.defaultAction as Decision) || "skip" };
      }
      setDecisions(init);
    } catch (e) {
      setRows([]);
      console.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const chosen = (rows ?? []).filter((r) => {
    const d = decisions[r.contractId];
    return d && d.action !== "skip" && d.typeName;
  });
  const destructiveCount = chosen.filter((r) => r.risky && decisions[r.contractId]?.action === "type_stages").length;

  const apply = React.useCallback(async () => {
    setBusy(true);
    try {
      const payload = {
        allowDestructive: destructiveCount > 0 ? allowDestructive : false,
        decisions: chosen.map((r) => ({ contractId: r.contractId, typeName: decisions[r.contractId].typeName, action: decisions[r.contractId].action })),
      };
      const res = await apiPostFix(payload);
      setResult(res);
      setConfirmOpen(false);
      setAllowDestructive(false);
      qc.invalidateQueries({ queryKey: ["contract-types"] });
      await analyze();
    } catch (e) {
      console.error(errMessage(e));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }, [chosen, decisions, allowDestructive, destructiveCount, qc, analyze]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm text-primary">
            <span className="flex items-center gap-1.5">
              <Wand2 className="size-4" aria-hidden />
              إصلاح العقود غير المحددة — تحليل ثم قرارات صريحة، لا يُحذف أي عقد أو سند
            </span>
            <Button size="sm" className="h-9 gap-1.5" onClick={analyze} disabled={busy}>
              {busy ? "جارٍ…" : rows ? "إعادة التحليل" : "تحليل العقود"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {result && (
            <div className="mb-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-bold">نتيجة التنفيذ: حُدّث نوع {result.typeUpdated} عقد · تُخّطي {result.skipped}</p>
              {result.log.map((l, i) => (
                <p key={i} className="text-muted-foreground">• {l}</p>
              ))}
              {result.problems.map((p, i) => (
                <p key={i} className="text-status-danger">✗ {p}</p>
              ))}
            </div>
          )}

          {!rows ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              اضغط «تحليل العقود» لفحص كل عقود النوع «غير محدد» — اقتراح النوع ومصدره وحالة مراحله وسنداته وهل إعادة البناء آمنة.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">لا يوجد أي عقد بنوع «غير محدد» — كل شيء سليم.</p>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">العقد</TableHead>
                      <TableHead className="text-start">المقترح (المصدر)</TableHead>
                      <TableHead className="text-start">المراحل · السندات</TableHead>
                      <TableHead className="text-start">النوع</TableHead>
                      <TableHead className="text-start">القرار</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const d = decisions[r.contractId] ?? { typeName: r.suggestedType, action: r.defaultAction as Decision };
                      return (
                        <TableRow key={r.contractId}>
                          <TableCell>
                            <div className="text-sm font-semibold" dir="ltr">{r.contractNumber}</div>
                            <div className="max-w-44 truncate text-[11px] text-muted-foreground" title={r.contractName}>{r.contractName}</div>
                            <div className="text-[11px] text-muted-foreground">{r.customerName} · {formatKWD(r.amount)}</div>
                          </TableCell>
                          <TableCell>
                            {r.suggestedType ? (
                              <>
                                <div className="text-sm font-medium">{r.suggestedType}</div>
                                <div className="text-[11px] text-muted-foreground">{r.source}{r.evidence ? `: «${r.evidence}»` : ""}</div>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">بلا اقتراح — اختر يدويًا</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-[11px]">{r.stagesState}</div>
                            <div className="text-[11px] text-muted-foreground">{r.receiptsState}</div>
                            {r.risky && (
                              <Badge className="mt-1 h-5 border-0 bg-status-warn-bg text-status-warn text-[10px]" title={r.riskReasons}>
                                <ShieldAlert className="size-3" aria-hidden />
                                يحتاج حذرًا
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={d.typeName}
                              onValueChange={(v) => setDecisions((p) => ({ ...p, [r.contractId]: { ...d, typeName: v } }))}
                            >
                              <SelectTrigger className="h-8 w-40 text-xs" aria-label={`نوع العقد ${r.contractNumber}`}>
                                <SelectValue placeholder="اختر النوع" />
                              </SelectTrigger>
                              <SelectContent>
                                {types.map((t) => (
                                  <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={d.action}
                              onValueChange={(v) => setDecisions((p) => ({ ...p, [r.contractId]: { ...d, action: v as Decision } }))}
                            >
                              <SelectTrigger className="h-8 w-40 text-xs" aria-label={`قرار العقد ${r.contractNumber}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(DECISION_LABEL) as Decision[]).map((k) => (
                                  <SelectItem key={k} value={k}>{DECISION_LABEL[k]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  مختار للتنفيذ: {chosen.length} عقد{destructiveCount > 0 ? ` · منها ${destructiveCount} إعادة بناء على تقدّم فعلي` : ""}
                </p>
                <Button size="sm" className="h-9" disabled={busy || chosen.length === 0} onClick={() => setConfirmOpen(true)}>
                  تنفيذ القرارات ({chosen.length})
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* تأكيد التنفيذ — نص المكتبي 234–262 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تنفيذ الإصلاح</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم الآن تحديث نوع {chosen.length} عقد
              {chosen.filter((r) => decisions[r.contractId]?.action === "type_only").length > 0 &&
                ` — منها ${chosen.filter((r) => decisions[r.contractId]?.action === "type_only").length} «تحديث النوع فقط» (مراحلها لن تُمس)`}
              {chosen.filter((r) => decisions[r.contractId]?.action === "type_stages").length > 0 &&
                ` — ومنها ${chosen.filter((r) => decisions[r.contractId]?.action === "type_stages").length} «إعادة بناء المراحل»`}.
              <br />
              لن يُحذف أي عقد أو عميل، ولن يُعدَّل أو يُلغى أي سند قبض. الدفعات غير المرتبطة بمرحلة ستُربط بمراحل القالب الجديد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {destructiveCount > 0 && (
            <div className="space-y-2 rounded-lg border border-status-warn/40 bg-status-warn-bg p-3 text-xs">
              <p className="flex items-start gap-1.5 font-medium text-status-warn">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                تحذير: {destructiveCount} عقد عليه تقدّم فعلي في المراحل واخترت له «إعادة بناء المراحل» — سيُحذف سجل مراحله الحالي ويُبنى من قالب النوع.
              </p>
              <label className="flex items-center gap-2 font-medium">
                <Checkbox checked={allowDestructive} onCheckedChange={(v) => setAllowDestructive(Boolean(v))} />
                أقرّ بإعادة بناء مراحل هذه العقود (بدون الإقرار تُنفَّذ «النوع فقط» تلقائيًا)
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>رجوع</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                apply();
              }}
              disabled={busy || (destructiveCount > 0 && !allowDestructive)}
            >
              {busy ? "جارٍ التنفيذ…" : "تنفيذ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** POST إصلاح — استدعاء مباشر بلا helper عام */
async function apiPostFix(payload: Record<string, unknown>): Promise<{ typeUpdated: number; skipped: number; problems: string[]; log: string[] }> {
  const res = await fetch("/api/contracts/fix-unspecified", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `فشل التنفيذ (${res.status})`);
  }
  return res.json();
}
