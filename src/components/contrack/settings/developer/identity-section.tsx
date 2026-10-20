"use client";

/**
 * تاب أدوات المطور «الهوية والترخيص» — مرآة المكتبية (settings.py:1100-1174):
 * «هوية النظام والترخيص» (اسم النظام · الحد الأقصى للمستخدمين) و«أيقونة البرنامج».
 *
 * فجوة موثقة (Task 52-a): حقلا app_name وmax_users يُخزنان في جدول Setting
 * بنسخة سطح المكتب ولا يوجد لهما عمود في نموذج Setting بالويب — تُعرض حقول
 * المكتبي للقراءة مع مؤشر «غير متاح»، وعدّاد المستخدمين حي من /api/users،
 * ولا يُعدَّل مخطط Prisma (القاعدة: تجنب تعديل المخطط إلا لحاجة قاطعة).
 * أيقونة البرنامج (نافذة/اختصار سطح المكتب) خاصة بالمكتبي بطبيعتها.
 */

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopOnlyCard } from "../shared";
import { ApiError, apiGet } from "../../api";
import { errMessage } from "../../contrack-types";

interface UsersListResponse {
  users: { id: number; username: string; role: string; active: boolean }[];
}

export function IdentitySection({ onAuthError }: { onAuthError: () => void }) {
  const usersQuery = useQuery<UsersListResponse>({
    queryKey: ["users", "identity-count"],
    queryFn: () => apiGet<UsersListResponse>("/api/users"),
    retry: false,
  });

  React.useEffect(() => {
    if (usersQuery.isError && usersQuery.error instanceof ApiError && usersQuery.error.status === 401) {
      onAuthError();
    }
  }, [usersQuery.isError, usersQuery.error, onAuthError]);

  const activeUsers = (usersQuery.data?.users ?? []).filter((u) => u.active).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">هوية النظام والترخيص</CardTitle>
          <p className="text-xs text-muted-foreground">
            حقول المكتبي للعرض — لا يوجد لها تخزين في قاعدة الويب (فجوة موثقة في worklog · Task 52-a).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 opacity-70">
              <Label htmlFor="dev-app-name">اسم النظام</Label>
              <Input id="dev-app-name" className="h-9" placeholder="ConTrack" readOnly disabled />
              <p className="text-xs text-muted-foreground">
                يظهر في عنوان النافذة وشاشة الدخول والقائمة الجانبية — غير متاح في نسخة الويب الحالية.
              </p>
            </div>
            <div className="space-y-1.5 opacity-70">
              <Label htmlFor="dev-max-users">الحد الأقصى للمستخدمين</Label>
              <Input id="dev-max-users" className="h-9" dir="ltr" type="number" readOnly disabled />
              <p className="text-xs text-muted-foreground">مستخدم (0 = بلا حد) — غير متاح في نسخة الويب الحالية.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            <Users className="size-4 text-primary" />
            {usersQuery.isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : usersQuery.isError ? (
              <span className="text-muted-foreground">تعذر عرض عدد المستخدمين — {errMessage(usersQuery.error)}</span>
            ) : (
              <span>
                المستخدمون حاليًا: <b className="tabular-nums">{activeUsers}</b>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <DesktopOnlyCard title="أيقونة البرنامج">
        <p>صورة مربّعة 256×256 أو أكبر · تُحوَّل تلقائيًا لكل المقاسات المطلوبة</p>
        <p>تغيير الأيقونة… / الأصلية — أيقونة نوافذ البرنامج واختصار سطح المكتب.</p>
      </DesktopOnlyCard>
    </div>
  );
}
