"use client";

/**
 * تاب أدوات المطور «الترحيل والاستيراد» — مرآة المكتبية (settings.py:1176-1216):
 * • النسخ الاحتياطي والاستعادة (الويب): /api/backup تنزيل JSON كامل +
 *   /api/backups قائمة النسخ المحفوظة على الخادم + /api/backups/restore
 *   استعادة مع نسخة أمان تلقائية — بتأكيد مزدوج (اختيار النسخة ثم نافذة تأكيد).
 * • «استيراد البيانات القديمة (Excel)» بنصوصه الحرفية — معالج بند 8 من المرحلة 9
 *   (import_wizard.py): قوالب الأوراق الثماني ← فحص بمعاينة وأخطاء برقم الصف ←
 *   تنفيذ بترتيب التبعية داخل معاملات ← تقرير النتائج، ويُخفى الكارت حين يكون
 *   مفتاح import_old مطفأً كما يفعل المكتبي (settings.py:1203-1206 V4.5.13).
 * • «تهيئة مراحل التنفيذ للعقود القديمة» أداة مكتبية لقواعد SQLite القديمة —
 *   تُعرض بنصوصها الحرفية ومؤشر «خاص بنسخة سطح المكتب».
 */

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { adminApi } from "@/lib/admin-api";
import { ApiError, apiGet, apiPost } from "../../api";
import {
  BACKUP_KIND_LABEL,
  errMessage,
  type BackupRestoreResponse,
  type BackupsResponse,
} from "../../contrack-types";
import { DesktopOnlyCard } from "../shared";
import { ImportWizard } from "./import-wizard";

export function MigrationSection({ importOldEnabled, onAuthError }: { importOldEnabled: boolean; onAuthError: () => void }) {
  const { toast } = useToast();

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  // ===== تنزيل نسخة احتياطية كاملة (JSON) — GET /api/backup =====
  const downloadMutation = useMutation<Awaited<ReturnType<typeof adminApi.downloadBackup>>, unknown, void>({
    mutationFn: () => adminApi.downloadBackup(),
    onSuccess: (res) => {
      toast({ title: "تم تنزيل النسخة", description: res.filename });
    },
    onError: (e) => fail(e, "تعذر تنزيل النسخة الاحتياطية"),
  });

  // ===== قائمة النسخ المحفوظة على الخادم + الاستعادة =====
  const backupsQuery = useQuery<BackupsResponse>({
    queryKey: ["backups", "migration-tab"],
    queryFn: () => apiGet<BackupsResponse>("/api/backups"),
    retry: false,
  });
  const serverBackups = (backupsQuery.data?.items ?? []).filter((b) => b.kind !== "safety" && b.exists);
  const [restoreTarget, setRestoreTarget] = React.useState<string>("");

  const restoreMutation = useMutation<BackupRestoreResponse, unknown, { fileName: string }>({
    mutationFn: (body) => apiPost<BackupRestoreResponse>("/api/backups/restore", body),
    onSuccess: (res) => {
      setRestoreTarget("");
      toast({ title: "تمت الاستعادة", description: res.message });
    },
    onError: (e) => fail(e, "تعذرت الاستعادة"),
  });

  return (
    <div className="space-y-4">
      {/* النسخ الاحتياطي والاستعادة (الويب) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">النسخ الاحتياطي والاستعادة</CardTitle>
          <p className="text-xs text-muted-foreground">
            نسخة JSON كاملة لقاعدة البيانات (تنزيل محلي أو محفوظة على الخادم مع فهرس) — والاستعادة تُنشئ
            نسخة أمان تلقائية من الوضع الحالي قبل أي تغيير. القائمة الكاملة في شاشة «إدارة البيانات».
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-9 gap-1.5"
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending}
            >
              {downloadMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              تنزيل نسخة احتياطية (JSON)
            </Button>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">استعادة من نسخة محفوظة على الخادم</div>
            {backupsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">جارٍ تحميل النسخ المحفوظة…</p>
            ) : backupsQuery.isError ? (
              <p className="text-xs text-destructive">تعذر تحميل النسخ المحفوظة — {errMessage(backupsQuery.error)}</p>
            ) : serverBackups.length === 0 ? (
              <p className="text-xs text-muted-foreground">لا نسخ محفوظة على الخادم بعد — أنشئ نسخة من شاشة «إدارة البيانات» أو نزّل نسخة محلية.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={restoreTarget} onValueChange={setRestoreTarget}>
                  <SelectTrigger className="h-9 w-72" aria-label="اختيار نسخة للاستعادة">
                    <SelectValue placeholder="اختر النسخة…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {serverBackups.map((b) => (
                      <SelectItem key={b.fileName} value={b.fileName}>
                        {b.fileName} · {BACKUP_KIND_LABEL[b.kind] ?? b.kind} · {(b.sizeKB).toLocaleString("en-US")} KB
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="destructive"
                  className="h-9 gap-1.5"
                  disabled={!restoreTarget || restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate({ fileName: restoreTarget })}
                >
                  {restoreMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  استعادة
                </Button>
                <p className="text-xs text-muted-foreground">اختيار النسخة ثم نافذة التأكيد — تأكيد مزدوج قبل أي كتابة.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* تأكيد الاستعادة — التأكيد الثاني (بذكر نسخة الأمان كالمكتبي) */}
      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-status-warn" />
              تأكيد الاستعادة
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm leading-6">
                <p>
                  استعادة «{restoreTarget}»؟ ستُستبدل قاعدة البيانات الحالية بالكامل بمحتوى النسخة مع الحفاظ
                  على المعرّفات الأصلية وإعادة ضبط التسلسلات.
                </p>
                <p className="rounded-md bg-amber-500/10 p-2 text-xs text-status-warn">
                  تُؤخذ نسخة أمان تلقائية من الوضع الحالي قبل الاستعادة (safety-…) ويمكن استعادتها لاحقًا —
                  وكل الخطوات داخل معاملة واحدة، إن فشل أي جزء تُرجع القاعدة كما كانت.
                </p>
                <p className="text-xs text-muted-foreground">هل أنت متأكد من المتابعة؟</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={restoreMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (restoreTarget) restoreMutation.mutate({ fileName: restoreTarget });
              }}
            >
              {restoreMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              تأكيد الاستعادة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* استيراد البيانات القديمة — يُخفى حين يكون المفتاح مطفأً كالمكتبي V4.5.13 */}
      {importOldEnabled && (
        <Card data-testid="import-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">📥 استيراد البيانات القديمة</CardTitle>
            <p className="text-xs text-muted-foreground">نزّل القالب، املأه، ثم افحصه قبل الاستيراد.</p>
          </CardHeader>
          <CardContent>
            <ImportWizard onAuthError={onAuthError} />
          </CardContent>
        </Card>
      )}

      {/* الخطوة صفر المكتبية (types_setup_service) — تأسيس الأنواع قبل رفع البيانات — خارج نطاق بند 8 */}
      {importOldEnabled && (
        <DesktopOnlyCard title="الخطوة صفر — رفع أنواع العقود والمراحل والدفعات من Excel">
          <p>الخطوة صفر (تُنفَّذ أولاً): أسّس أنواع العقود ومراحلها ودفعاتها · بدونها تدخل العقود تحت «غير محدد» بمراحل غير صحيحة</p>
          <p>أزرار «⬇ تنزيل قالب الأنواع والمراحل والدفعات» و«رفع أنواع العقود والمراحل والدفعات من Excel» و«🔧 إصلاح عقود غير محدد» من المعالج المكتبي.</p>
        </DesktopOnlyCard>
      )}

      {/* أداة الترحيل المكتبية للقواعد القديمة — تُعرض ولا تُحذف (قاعدة المرحلة 9) */}
      <DesktopOnlyCard title="تهيئة مراحل التنفيذ للعقود القديمة">
        <p>ترقية مراحل العقود القديمة إلى شجرة تنفيذ.</p>
        <p>✚ تهيئة العقود القديمة الآن — لقواعد SQLite المكتبية المستعادة من نسخ قديمة؛ قاعدة الويب أُنشئت بالأشجار أصلاً.</p>
      </DesktopOnlyCard>
    </div>
  );
}
