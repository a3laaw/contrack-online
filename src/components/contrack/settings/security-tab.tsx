"use client";

/**
 * تبويب «◆ الأمان والمستخدمون» / «◆ كلمة المرور» — مرآة _tab_security_users
 * (settings.py:2316-2348 + 1376-1386): كارت بيانات تسجيل الدخول للمستخدم
 * الحالي، وكارت «المستخدمون والصلاحيات» للمدير — تتم إدارته في الويب من
 * الشاشة المستقلة «المستخدمون» (بند مستقل في الشل بصلاحية adminOnly كالمكتبي).
 */

import { UserCog } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SecurityTab({ manager, username }: { manager: boolean; username?: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <UserCog className="size-4 text-primary" />
        <CardTitle className="text-base">{manager ? "الأمان والمستخدمون" : "كلمة المرور"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed">
        {username ? (
          <p className="font-bold text-primary">المستخدم الحالي: {username}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">تسجيل الدخول مطلوب عند تشغيل البرنامج.</p>
        {manager ? (
          <p className="text-muted-foreground">
            إدارة المستخدمين وكلمات المرور والصلاحيات (screen_* · action_* · report_*) تتم من
            الشاشة المستقلة «المستخدمون» — افتحها من القائمة الجانبية للنظام؛ لا يوجد تكرار لها هنا.
          </p>
        ) : (
          <p className="text-muted-foreground">
            تغيير كلمة مرور حسابك يتم بواسطة المدير من الشاشة المستقلة «المستخدمون» —
            اطلب ذلك من مدير النظام.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
