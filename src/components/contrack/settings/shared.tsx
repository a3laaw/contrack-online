"use client";

/**
 * مشتركات تبويبات الإعدادات — أنماط موحدة نقلتها من SettingsView القديم
 * (SaveRow · خيارات غير متاحة · بطاقة «خاص بنسخة سطح المكتب») + نموذج الإعدادات.
 * النصوص الحرفية للمكتبي تُنقل كما هي في كل تبويب على حدة.
 */

import * as React from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SettingsDTO } from "../contrack-types";

/** إعدادات النموذج — تشمل حقول النسخ التلقائي الموجودة في الخادم */
export type SettingsFormDTO = SettingsDTO & {
  autoBackupEnabled?: boolean;
  autoBackupInterval?: number;
};

// ==================== صف الحفظ (كالمكتبي _save_row) ====================

export function SaveRow({
  onReset,
  onSave,
  pending,
}: {
  onReset: () => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t pt-3">
      <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onReset} disabled={pending}>
        <RotateCcw className="size-4" />
        استعادة
      </Button>
      <Button size="sm" className="h-9 gap-1.5" onClick={onSave} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        حفظ الإعدادات
      </Button>
    </div>
  );
}

// ==================== خيار غير متاح (نمط شفاف واضح) ====================

export function UnavailableOption({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed p-3 opacity-60">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">غير متاح في نسخة الويب الحالية</span>
    </div>
  );
}

/**
 * بطاقة «خاص بنسخة سطح المكتب» — للتبويبات المكتبية بلا مقابل ويب
 * (قاعدة: لا يُحذف تبويب مكتبي، يُعرض بنصوصه الحرفية ومؤشر وضوح).
 */
export function DesktopOnlyCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Card className="opacity-80">
      <CardHeader className="pb-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {title}
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">
            خاص بنسخة سطح المكتب — غير متاح في الويب
          </span>
        </CardTitle>
      </CardHeader>
      {children ? <CardContent className="space-y-1.5 text-xs text-muted-foreground">{children}</CardContent> : null}
    </Card>
  );
}
