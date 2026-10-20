"use client";

/**
 * تبويب «▤ الطباعة والعرض» — مرآة المكتبي _tab_appearance (settings.py:879-917):
 * كارت هوية المطبوعات (هيدر/فوتر/توقيع/ختم) خاص بالمكتبي (صور ملفات محلية)،
 * وخيارات الطباعة والعرض بنصوصه الحرفية. النص التمهيدي حرفي:
 * «إعدادات الطباعة هنا؛ تبويب المطور للترخيص والترحيل.»
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DesktopOnlyCard, UnavailableOption } from "./shared";

export function AppearanceTab() {
  return (
    <div className="space-y-4">
      <DesktopOnlyCard title="هوية المطبوعات: الهيدر والفوتر والختم">
        <p>ارفع الهيدر والفوتر والتوقيع والختم وحدد موضع الختم.</p>
        <p>صورة الهيدر · صورة الفوتر · التوقيع · صورة الختم · مكان الختم (يمين/يسار · أعلى/أسفل · الحجم)</p>
      </DesktopOnlyCard>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">خيارات الطباعة والعرض</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">إعدادات الطباعة هنا؛ تبويب المطور للترخيص والترحيل.</p>
          <UnavailableOption
            title="🖨 وضع الطباعة الاقتصادي"
            desc="طباعة أبيض وأسود لتوفير الحبر."
          />
          <UnavailableOption
            title="⚡ الوضع السريع"
            desc="يسرّع الأجهزة القديمة بإيقاف ظلال البطاقات. يُطبق بعد إعادة التشغيل."
          />
        </CardContent>
      </Card>
    </div>
  );
}
