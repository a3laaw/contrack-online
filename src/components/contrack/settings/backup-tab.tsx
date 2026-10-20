"use client";

/**
 * تبويب «⊞ البيانات والنسخ الاحتياطي» — مرآة _tab_backup المكتبية
 * (settings.py:3538-3652): النسخ الاحتياطي التلقائي + تنبيهات انتهاء
 * العقود وتحصيل متأخر + بطاقة النسخ اليدوي والاستعادة — الأسلاك عبر
 * /api/settings كما كانت، والنسخ اليدوي في شاشة «إدارة البيانات» المستقلة.
 */

import { DatabaseBackup } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SaveRow, type SettingsFormDTO } from "./shared";

export interface BackupTabProps {
  form: SettingsFormDTO;
  upd: (patch: Partial<SettingsFormDTO>) => void;
  onReset: () => void;
  onSave: () => void;
  savePending: boolean;
}

export function BackupTab({ form, upd, onReset, onSave, savePending }: BackupTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">النسخ الاحتياطي التلقائي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={Boolean(form.autoBackupEnabled)} onCheckedChange={(v) => upd({ autoBackupEnabled: v })} />
              <span className="text-sm font-medium">تفعيل النسخ التلقائي كل</span>
            </div>
            <Input
              className="h-9 w-24"
              dir="ltr"
              type="number"
              min="1"
              max="168"
              value={String(form.autoBackupInterval ?? 24)}
              onChange={(e) => upd({ autoBackupInterval: Math.max(1, Math.trunc(Number(e.target.value || 24))) })}
            />
            <span className="text-sm">ساعة</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-expiry">تنبيهات انتهاء العقود قبل (أيام):</Label>
              <Input
                id="s-expiry"
                className="h-9"
                dir="ltr"
                placeholder="90,60,30,7"
                value={form.expiryAlerts ?? ""}
                onChange={(e) => upd({ expiryAlerts: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">افصل بين الأيام بفاصلة</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-collection">تنبيه تحصيل متأخر بعد:</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="s-collection"
                  className="h-9 w-24"
                  dir="ltr"
                  type="number"
                  min="7"
                  max="365"
                  value={String(form.collectionAlertDays ?? 30)}
                  onChange={(e) => upd({ collectionAlertDays: Math.max(7, Math.trunc(Number(e.target.value || 30))) })}
                />
                <span className="text-sm">يوم</span>
              </div>
              <p className="text-xs text-muted-foreground">بلا سند قبض على عقد عليه متبقٍ</p>
            </div>
          </div>
          <SaveRow
            onReset={onReset}
            onSave={onSave}
            pending={savePending}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
          <DatabaseBackup className="size-4 text-primary" />
          <CardTitle className="text-base">النسخ اليدوي والاستعادة</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-muted-foreground">
          <p>
            إنشاء النسخ الاحتياطية واستعادتها وفهرس النسخ يُدار من الشاشة المستقلة
            «إدارة البيانات» — افتحها من القائمة الجانبية للنظام.
          </p>
          <p className="mt-1 text-xs">أدوات قاعدة البيانات فقط؛ لا تشمل ملفات الأرشيف أو المرفقات.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// Skeleton مستخدم للحفاظ على نمط التحميل في نقطة الدخول
export function BackupTabSkeleton() {
  return <Skeleton className="h-52 rounded-xl" />;
}
