"use client";

import * as React from "react";
import { Loader2, FileSignature, Lock, User as UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface LoginViewProps {
  onLoggedIn: (user: User, token: string, perms?: Record<string, boolean>) => void;
}

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

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
      // Task 100: المطور غير مربوط بأي شركة — يدخل لوحة المطور مباشرة بلا شاشة اختيار،
      // والبقية يدخلون شركتهم مباشرة كالسابق
      onLoggedIn(res.user, res.token, res.perms);
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
