"use client";

/**
 * حوار استيراد البرنامج الزمني CPM — اختيار → معاينة → تأكيد (docs/schedule-import-design.md §3/§6 ب1).
 * يُركَّب من قسم «البرنامج الزمني» في شاشة العقد: يسحب النظام الأنشطة (≈600) بتواريخ
 * Early/Late من PDFPrimavera (أو xlsx مصدَّر منه) ويعرض معاينة المطابقة بالأقسام:
 * كل قسم × نافذته الزمنية المشتقة × عدد أنشطته × قيمة قسمه في BOQ — ثم يلحّق الدفعة
 * (إلحاق لا استبدال — Baseline محفوظ) ويملأ نافذة كل بند من نافذة قسمه.
 */

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarRange, ChevronDown, FileText, Loader2, Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPostForm } from "./api";
import { errMessage } from "./contrack-types";
import { formatKWD } from "@/lib/format";
import type { ScheduleImportPreviewDTO } from "@/lib/schedule-types";

interface ScheduleImportDialogProps {
  contractId: number;
  contractNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** بعد الاستيراد الناجح — إبطال استعلامات البرنامج الزمني والبنود */
  onImported: () => void;
  onAuthError: () => void;
}

/** تنسيق تاريخ ISO قصير «2026-02-28» للعرض */
function fmtDate(d: string): string {
  return d ? d.slice(2) : "—";
}

export function ScheduleImportDialog({
  contractId, contractNumber, open, onOpenChange, onImported, onAuthError,
}: ScheduleImportDialogProps) {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ScheduleImportPreviewDTO | null>(null);
  const [openDiv, setOpenDiv] = React.useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "preview");
      return apiPostForm<ScheduleImportPreviewDTO>(`/api/contracts/${contractId}/schedule/import`, fd);
    },
    onSuccess: (data) => {
      setPreview(data);
      setOpenDiv(data.divisions[0]?.code ?? null);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر سحب الأنشطة", description: errMessage(e) });
    },
  });

  const runMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "run");
      return apiPostForm<{ importId: number; created: number; work: number; filledDivisions: number }>(
        `/api/contracts/${contractId}/schedule/import`, fd,
      );
    },
    onSuccess: (data) => {
      toast({
        title: "تم استيراد البرنامج الزمني",
        description: `${data.created} نشطة (${data.work} عمل) — عُبّئت نوافذ ${data.filledDivisions} قسمًا في بنود الكميات`,
      });
      onImported();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الاستيراد", description: errMessage(e) });
    },
  });

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/(\.pdf|\.xlsx)$/i.test(f.name)) {
      toast({ variant: "destructive", title: "صيغة غير مدعومة", description: "الصيغتان المدعومتان: PDF أو xlsx" });
      return;
    }
    setFile(f);
    setPreview(null);
    previewMutation.mutate(f);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setOpenDiv(null);
    previewMutation.reset();
    runMutation.reset();
  };

  const busy = previewMutation.isPending || runMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && runMutation.isPending) return; // لا إغلاق أثناء التنفيذ
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        {open && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarRange className="size-5 text-amber-700 dark:text-amber-400" aria-hidden />
                استيراد البرنامج الزمني (CPM)
              </DialogTitle>
              <DialogDescription>
                ارفع ملف Primavera — PDF مباشرة أو xlsx مصدَّر منه. يسحب النظام الأنشطة بتواريخها
                المخططة ويطابقها بأقسام BOQ. العقد {contractNumber}.
              </DialogDescription>
            </DialogHeader>

            {/* الخطوة 1: اختيار الملف */}
            {!preview && (
              <div className="space-y-3 py-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-amber-500/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors p-8 text-center disabled:opacity-60"
                  aria-label="اختيار ملف البرنامج الزمني"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-8 mx-auto mb-2 animate-spin text-muted-foreground" aria-hidden />
                      <span className="text-sm text-muted-foreground">جارٍ سحب الأنشطة من الملف…</span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-8 mx-auto mb-2 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-semibold block mb-1">
                        {file ? file.name : "اختر ملف البرنامج الزمني (PDF أو xlsx)"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        CPM Detailed Schedule من Primavera — الأنشطة بأعمدة Early/Late Start/Finish
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* الخطوة 2: المعاينة */}
            {preview && (
              <div className="space-y-4 py-1">
                {/* بطاقة الجدول */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">الأنشطة</p>
                    <p className="text-lg font-bold tabular-nums">{preview.counts.total - preview.counts.summary}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">أنشطة عمل (ذو قيمة)</p>
                    <p className="text-lg font-bold tabular-nums">{preview.counts.work}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">بداية المشروع</p>
                    <p className="text-sm font-bold tabular-nums" dir="ltr">{fmtDate(preview.meta.projectStart)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">نهاية المشروع</p>
                    <p className="text-sm font-bold tabular-nums" dir="ltr">{fmtDate(preview.meta.projectFinish)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {preview.meta.revision && (
                    <Badge variant="secondary" className="text-[11px]">المراجعة {preview.meta.revision}</Badge>
                  )}
                  {preview.meta.dataDate && (
                    <Badge variant="outline" className="text-[11px] tabular-nums">Data Date {fmtDate(preview.meta.dataDate)}</Badge>
                  )}
                  {preview.meta.totalPages > 0 && (
                    <Badge variant="outline" className="text-[11px] tabular-nums">{preview.meta.totalPages} صفحة</Badge>
                  )}
                </div>

                {preview.latest && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                    <span>
                      يوجد استيراد سابق «{preview.latest.fileName}» {preview.latest.revision && `(${preview.latest.revision})`} —
                      الاستيراد الجديد <b>يُلحق دفعة جديدة</b> وتصبح الأحدث هي الحية، والسابق يبقى Baseline محفوظاً.
                    </span>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 space-y-1">
                    {preview.warnings.slice(0, 6).map((w, i) => (
                      <p key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                        <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
                        <span>{w.message}</span>
                      </p>
                    ))}
                  </div>
                )}

                {/* نوافذ الأقسام مقابل قيم BOQ */}
                <div className="rounded-xl border divide-y max-h-80 overflow-y-auto">
                  {preview.divisions.map((d) => (
                    <div key={d.code}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-start"
                        onClick={() => setOpenDiv(openDiv === d.code ? null : d.code)}
                        aria-expanded={openDiv === d.code}
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${openDiv === d.code ? "" : "-rotate-90"}`}
                          aria-hidden
                        />
                        <Badge variant="secondary" className="tabular-nums shrink-0" dir="ltr">{d.code}</Badge>
                        <span className="font-semibold text-sm truncate flex-1">{d.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{d.activityCount} نشطة</span>
                        <span className="text-xs tabular-nums shrink-0 text-muted-foreground" dir="ltr">
                          {fmtDate(d.start)} ← {fmtDate(d.finish)}
                        </span>
                        <span className="text-sm font-bold tabular-nums shrink-0" dir="ltr">{formatKWD(d.boqTotal)}</span>
                      </button>
                      {openDiv === d.code && (
                        <div className="px-3 pb-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                          <span>بنود BOQ في القسم: <b className="tabular-nums">{d.boqItems}</b></span>
                          <span>قيمة القسم: <b className="tabular-nums" dir="ltr">{formatKWD(d.boqTotal)}</b></span>
                          <span>نافذة البنود المخططة: <b className="tabular-nums" dir="ltr">{fmtDate(d.start)} ← {fmtDate(d.finish)}</b></span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  <FileText className="size-3.5 inline me-1" aria-hidden />
                  النظام يقرأ الجدول كما هو ولا يعيد حساب شبكة CPM — أي تحديث يأتي كملف جديد (R02) يُلحّق دفعة مستقلة.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" disabled={runMutation.isPending} onClick={() => { reset(); onOpenChange(false) }}>
                {preview ? "إلغاء" : "إغلاق"}
              </Button>
              {preview && (
                <>
                  <Button variant="outline" className="h-11 gap-2" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="size-4" aria-hidden />
                    ملف آخر
                  </Button>
                  <Button
                    className="h-11 gap-2 font-semibold"
                    disabled={busy || preview.counts.work === 0}
                    onClick={() => file && runMutation.mutate(file)}
                  >
                    {runMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    استيراد {preview.counts.total - preview.counts.summary} نشطة
                  </Button>
                </>
              )}
            </DialogFooter>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
