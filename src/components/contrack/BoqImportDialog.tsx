"use client";

/**
 * حوار استيراد BOQ من ملف xlsx — اختيار → معاينة → تأكيد (docs/boq-import-design.md §2.4).
 * يُركَّب من قسم «بنود الكميات» في شاشة العقد (ContractDetailView): يسحب النظام
 * البنود المسعّرة بأرقامها وأقسامها من ملف BOQ الكويتي (POMI) ويتحقق مقابل
 * الملخص العام داخل الملف إن وُجد، ثم يلحقها ببنود العقد (إلحاق لا استبدال).
 */

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, ChevronDown, FileSpreadsheet, Loader2, Upload,
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
import type { BoqImportPreviewDTO } from "@/lib/boq-types";

interface BoqImportDialogProps {
  contractId: number;
  contractNumber: string;
  /** قيمة العقد للمقارنة في المعاينة */
  contractAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** بعد الاستيراد الناجح — إبطال استعلامات البنود */
  onImported: () => void;
  onAuthError: () => void;
}

export function BoqImportDialog({
  contractId, contractNumber, contractAmount, open, onOpenChange, onImported, onAuthError,
}: BoqImportDialogProps) {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<BoqImportPreviewDTO | null>(null);
  const [openDiv, setOpenDiv] = React.useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "preview");
      return apiPostForm<BoqImportPreviewDTO>(`/api/contracts/${contractId}/boq/import`, fd);
    },
    onSuccess: (data) => {
      setPreview(data);
      setOpenDiv(data.divisions[0]?.code ?? null);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر سحب البنود", description: errMessage(e) });
    },
  });

  const runMutation = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", "run");
      return apiPostForm<{ created: number; grandTotal: number }>(`/api/contracts/${contractId}/boq/import`, fd);
    },
    onSuccess: (data) => {
      toast({
        title: "تم الاستيراد",
        description: `استُورد ${data.created} بنداً من ملف BOQ — الإجمالي ${formatKWD(data.grandTotal)}`,
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
    if (!/\.xlsx$/i.test(f.name)) {
      toast({ variant: "destructive", title: "صيغة غير مدعومة", description: "الصيغة المدعومة xlsx حصراً" });
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
                <FileSpreadsheet className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
                استيراد جدول كميات (BOQ) من ملف
              </DialogTitle>
              <DialogDescription>
                ارفع ملف Excel بصيغة xlsx — يسحب النظام البنود المسعّرة بأرقامها وأقسامها ويتحقق
                مقابل الملخص العام في الملف إن وُجد. العقد {contractNumber}.
              </DialogDescription>
            </DialogHeader>

            {/* الخطوة 1: اختيار الملف */}
            {!preview && (
              <div className="space-y-3 py-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-emerald-500/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors p-8 text-center disabled:opacity-60"
                  aria-label="اختيار ملف BOQ"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-8 mx-auto mb-2 animate-spin text-muted-foreground" aria-hidden />
                      <span className="text-sm text-muted-foreground">جارٍ سحب البنود من الملف…</span>
                    </>
                  ) : (
                    <>
                      <Upload className="size-8 mx-auto mb-2 text-muted-foreground" aria-hidden />
                      <span className="text-sm font-semibold block mb-1">
                        {file ? file.name : "اختر ملف BOQ (xlsx)"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        يدعم الملفات الكويتية بنمط POMI — أقسام مدنية وميكانيكية وكهربائية، صفحات التجميع،
                        وبنود المشمولات
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* الخطوة 2: المعاينة */}
            {preview && (
              <div className="space-y-4 py-1">
                {/* بطاقة الإجماليات */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">الأقسام</p>
                    <p className="text-lg font-bold tabular-nums">{preview.divisions.length}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">البنود المسحوبة</p>
                    <p className="text-lg font-bold tabular-nums">{preview.itemCount}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">إجمالي الملف</p>
                    <p className="text-lg font-bold tabular-nums" dir="ltr">{formatKWD(preview.grandTotal)}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">قيمة العقد</p>
                    <p className="text-lg font-bold tabular-nums" dir="ltr">{formatKWD(contractAmount)}</p>
                  </div>
                </div>

                {preview.existingCount > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                    <span>
                      العقد يحتوي {preview.existingCount} بنداً قائماً — الاستيراد <b>يضيف إليها</b> ولا يستبدلها.
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
                    {preview.warnings.length > 6 && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        و{preview.warnings.length - 6} تنبيهاً آخر…
                      </p>
                    )}
                  </div>
                )}

                {/* الأقسام — قابلة للفتح لعينة بنود */}
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
                        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{d.itemCount} بند</span>
                        <span className="text-sm font-bold tabular-nums shrink-0" dir="ltr">{formatKWD(d.total)}</span>
                      </button>
                      {openDiv === d.code && (
                        <div className="px-3 pb-3 space-y-1.5">
                          {d.items.map((it, i) => (
                            <div key={i} className="flex items-baseline gap-2 text-xs rounded-lg bg-muted/50 px-2.5 py-2">
                              <span className="tabular-nums text-muted-foreground shrink-0 min-w-14 text-center" dir="ltr">
                                {it.itemNo || "—"}
                              </span>
                              <span className="flex-1 line-clamp-2 leading-relaxed">{it.description}</span>
                              <span className="tabular-nums shrink-0 text-muted-foreground">{it.qty} {it.unit}</span>
                              <span className="tabular-nums shrink-0 font-semibold" dir="ltr">{formatKWD(it.amount)}</span>
                            </div>
                          ))}
                          {d.itemCount > d.items.length && (
                            <p className="text-xs text-muted-foreground text-center">
                              أول {d.items.length} من {d.itemCount} بنداً — سيُستورد الجميع عند التأكيد
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  سطور شروح متخطاة: {preview.meta.narrativeLines} · مدمجة في الأوصاف: {preview.meta.mergedLines} ·
                  صفحات إجماليات معاد عرضها (سقطت): {preview.meta.recapPages}
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
                    disabled={busy || preview.itemCount === 0}
                    onClick={() => file && runMutation.mutate(file)}
                  >
                    {runMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    استيراد {preview.itemCount} بنداً
                  </Button>
                </>
              )}
            </DialogFooter>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
