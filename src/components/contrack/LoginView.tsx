"use client";

import * as React from "react";
import { Loader2, FileSignature, Lock, User as UserIcon, ShieldCheck, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface LoginViewProps {
  onLoggedIn: (user: User, token: string, perms?: Record<string, boolean>, initialView?: string) => void;
}

interface PendingLogin {
  user: User;
  token: string;
  perms?: Record<string, boolean>;
}

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // لوحة المطور (Task 97): بعد دخول مطور نعرض شاشة اختيار نقطة الدخول —
  // لوحة المطور أو شركته الأم. غير المطور يدخل شركته مباشرة كالسابق.
  const [pending, setPending] = React.useState<PendingLogin | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await apiPost<{ user: User; token: string; perms?: Record<string, boolean> }>("/api/auth/login", {
        username: username.trim(),
        password,
      });
      if (res.user.role === "developer") {
        setPending({ user: res.user, token: res.token, perms: res.perms });
      } else {
        onLoggedIn(res.user, res.token, res.perms);
      }
    } catch (err) {
      const msg = errMessage(err);
      setError(
        msg.includes("401") || /credential|مستخدم|كلمة/i.test(msg)
          ? "اسم المستخدم أو كلمة المرور غير صحيحة"
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  // ===== شاشة اختيار نقطة الدخول — للمطور فقط =====
  if (pending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <FileSignature className="size-7" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-primary">مرحبًا، {pending.user.fullName || pending.user.username}</h1>
            <p className="text-sm text-muted-foreground">حساب مطوّر — اختر من أين تبدأ</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => onLoggedIn(pending.user, pending.token, pending.perms, "dev-console")}
              className="group text-start rounded-xl border-2 border-primary/30 bg-primary-soft hover:border-primary hover:shadow-lg hover:shadow-primary/10 transition-all p-5 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
                <ShieldCheck className="size-6" />
              </div>
              <p className="font-bold text-primary-soft-foreground">لوحة تحكم المطور</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                إدارة الشركات — إضافة شركة، الدخول إليها، متابعة الأرقام العامة
              </p>
            </button>

            <button
              type="button"
              onClick={() => onLoggedIn(pending.user, pending.token, pending.perms)}
              className="group text-start rounded-xl border-2 border-border bg-card hover:border-primary/50 hover:shadow-md transition-all p-5 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground mb-3">
                <Building2 className="size-6" />
              </div>
              <p className="font-bold">الدخول إلى شركتي</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                النظام المعتاد داخل شركة «{pending.user.companyName || "الشركة الرئيسية"}»
              </p>
            </button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            يمكنك فتح لوحة المطور لاحقًا في أي وقت من أيقونة الدرع في الشريط العلوي
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* الشعار */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <FileSignature className="size-7" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-primary">ConTrack</h1>
          <p className="text-sm text-muted-foreground">نظام إدارة العقود والمحاسبة — V9.15</p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">تسجيل الدخول</CardTitle>
            <CardDescription>أدخل بيانات حسابك للوصول إلى النظام</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="username">اسم المستخدم</Label>
                <div className="relative">
                  <UserIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    className="h-10 ps-9"
                    dir="ltr"
                    autoComplete="username"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    className="h-10 ps-9"
                    dir="ltr"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
                  {error}
                </p>
              )}

              <Button type="submit" className="h-10 w-full gap-2" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    جارٍ الدخول…
                  </>
                ) : (
                  "دخول"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          ConTrack V9.15 — إدارة العقود والمحاسبة
        </p>
      </div>
    </div>
  );
}
