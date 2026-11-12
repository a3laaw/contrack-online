"use client";

/**
 * تبويب «◆ الأمان والمستخدمون» / «◆ كلمة المرور» — مرآة _tab_security_users
 * (settings.py:2316-2348 + 1376-1386): كارت بيانات تسجيل الدخول للمستخدم
 * الحالي، وكارت «المستخدمون والصلاحيات» للمدير — تتم إدارته في الويب من
 * الشاشة المستقلة «المستخدمون» (بند مستقل في الشل بصلاحية adminOnly كالمكتبي).
 * الجلسة 13 — سد فجوة موثقة: تغيير كلمة المرور الذاتي عبر PATCH /api/auth/credentials
 * (كان المسار موجودًا بلا مستهلك UI) — للمستخدم الحالي أيًا كان دوره كالمكتبي.
 */

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPatch } from "../api";
import { errMessage } from "../contrack-types";

/** كارت تغيير كلمة مروري — الجلسة 13 (المسار كان يتيمًا بلا واجهة) */
function PasswordChangeCard({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  const valid =
    oldPassword.length > 0 && newPassword.length >= 6 && newPassword === confirm;

  const mutation = useMutation({
    mutationFn: () =>
      apiPatch<{ message: string }>("/api/auth/credentials", { oldPassword, newPassword }),
    onSuccess: (res) => {
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      toast({ title: "تم تغيير كلمة المرور", description: res.message });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر تغيير كلمة المرور", description: errMessage(e) });
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <KeyRound className="size-4 text-primary-ink" />
        <CardTitle className="text-base">تغيير كلمة المرور</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pw-old">كلمة المرور الحالية</Label>
            <Input
              id="pw-old"
              className="h-9"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">الجديدة (6 أحرف على الأقل)</Label>
            <Input
              id="pw-new"
              className="h-9"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm">تأكيد الجديدة</Label>
            <Input
              id="pw-confirm"
              className="h-9"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        {newPassword.length > 0 && newPassword.length < 6 && (
          <p className="text-xs text-destructive">كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.</p>
        )}
        {confirm.length > 0 && newPassword !== confirm && (
          <p className="text-xs text-destructive">التأكيد لا يطابق كلمة المرور الجديدة.</p>
        )}
        <div>
          <Button
            className="h-9"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "جارٍ التغيير…" : "تغيير كلمة المرور"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SecurityTab({
  manager,
  username,
  onAuthError,
}: {
  manager: boolean;
  username?: string;
  onAuthError?: () => void;
}) {
  return (
    <div className="space-y-4">
      <PasswordChangeCard onAuthError={onAuthError ?? (() => {})} />
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
          <UserCog className="size-4 text-primary-ink" />
          <CardTitle className="text-base">{manager ? "الأمان والمستخدمون" : "كلمة المرور"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          {username ? (
            <p className="font-bold text-primary-ink">المستخدم الحالي: {username}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">تسجيل الدخول مطلوب عند تشغيل البرنامج.</p>
          {manager ? (
            <p className="text-muted-foreground">
              إدارة المستخدمين وكلمات المرور والصلاحيات (screen_* · action_* · report_*) تتم من
              الشاشة المستقلة «المستخدمون» — افتحها من القائمة الجانبية للنظام؛ لا يوجد تكرار لها هنا.
            </p>
          ) : (
            <p className="text-muted-foreground">
              تغيير كلمة مرور حسابك يتم من الكارت أعلاه مباشرة — وإدارة المستخدمين الآخرين تتم
              بواسطة المدير من الشاشة المستقلة «المستخدمون».
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
