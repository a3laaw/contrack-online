"use client";

/**
 * تاب أدوات المطور «الشبكة والنسخ» — مرآة المكتبية (settings.py:1218-1230):
 * كارت «العمل على شبكة محلية» (network_single_db لمجلد مشترك مع SQLite)
 * خاص بنسخة سطح المكتب بطبيعته — قاعدة الويب Postgres/Supabase مشتركة
 * بين كل الأجهزة أصلاً بلا أي إعداد. وكارت «النسخة الاحتياطية الكاملة»
 * (full_backup) نصوصه الحرفية مع بديل الويب (شاشة إدارة البيانات وتبويب
 * الترحيل والاستيراد). يُخفى الكارتان حين يكون مفتاحهما مطفأً كالمكتبي
 * (V4.5.13 — settings.py:1223-1229).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DesktopOnlyCard } from "../shared";

export function NetworkSection({ networkFolderEnabled, fullBackupEnabled }: { networkFolderEnabled: boolean; fullBackupEnabled: boolean }) {
  return (
    <div className="space-y-4">
      {networkFolderEnabled && (
        <DesktopOnlyCard title="العمل على شبكة محلية (عدة أجهزة)">
          <p>اختر مجلد بيانات مشترك لكل الأجهزة ثم أعد تشغيل البرنامج.</p>
          <p>الوضع الحالي: قاعدة بيانات محلية على هذا الجهاز.</p>
          <p>المجلد المشترك: (فارغ = قاعدة هذا الجهاز) شبكة: \\SERVER\ConTrackData · مضيف: C:\ConTrackData</p>
          <p>استعراض… · تفعيل / تحديث · حذف المسار / محلي — يمسح مسار قاعدة الشبكة من هذا الجهاز فقط ويرجع للقاعدة المحلية.</p>
        </DesktopOnlyCard>
      )}

      {fullBackupEnabled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">النسخة الاحتياطية الكاملة</CardTitle>
            <p className="text-xs text-muted-foreground">نسخ احتياطي تلقائي للبيانات والملفات.</p>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            <p>
              المكتبى: جدولة أسبوعية/بمدة بالأيام مع نسخ شهرية بعيدة ومجلد حفظ قابل للاختيار — خاص بنسخة سطح المكتب
              (أرشفة ملفات المرفقات من القرص).
            </p>
            <p>
              الويب: النسخ الكاملة JSON محفوظة على الخادم في شاشة «إدارة البيانات» ← تبويب «النسخ الاحتياطي»،
              أو نزّل نسخة محلية من تبويب «الترحيل والاستيراد» أعلاه — والاستعادة بأخذ نسخة أمان تلقائية.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
