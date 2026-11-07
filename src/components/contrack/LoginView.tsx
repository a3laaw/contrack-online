"use client";

import * as React from "react";
import { Loader2, FileSignature, Lock, User as UserIcon, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface LoginViewProps {
  onLoggedIn: (user: User, token: string, perms?: Record<string, boolean>) => void;
}

const EMPTY_JOIN = {
  companyName: "",
  shortName: "",
  contactName: "",
  phone: "",
  email: "",
  activity: "",
  requestedUsername: "",
  password: "",
  confirm: "",
};

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // طلب انضمام شركة جديدة (Task 115) — يصل المطور كطلب معلق ويُعتمد من لوحته
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [join, setJoin] = React.useState(EMPTY_JOIN);
  const [joinError, setJoinError] = React.useState("");
  const [joinDone, setJoinDone] = React.useState(false);
  const [joinLoading, setJoinLoading] = React.useState(false);

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

  const submitJoin = async () => {
    setJoinError("");
    if (!join.companyName.trim() || !join.contactName.trim()) {
      setJoinError("اسم الشركة ومسؤول التواصل مطلوبان");
      return;
    }
    if (join.requestedUsername.trim().length < 3 || /\s/.test(join.requestedUsername.trim())) {
      setJoinError("اسم المستخدم: 3 أحرف على الأقل وبلا فراغات");
      return;
    }
    if (join.password.length < 6) {
      setJoinError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (join.password !== join.confirm) {
      setJoinError("كلمتا المرور غير متطابقتين");
      return;
    }
    setJoinLoading(true);
    try {
      await apiPost<{ id: number }>("/api/register", {
        companyName: join.companyName.trim(),
        shortName: join.shortName.trim(),
        contactName: join.contactName.trim(),
        phone: join.phone.trim(),
        email: join.email.trim(),
        activity: join.activity.trim(),
        requestedUsername: join.requestedUsername.trim(),
        password: join.password,
      });
      setJoinDone(true);
    } catch (err) {
      setJoinError(errMessage(err));
    } finally {
      setJoinLoading(false);
    }
  };

  const closeJoin = (open: boolean) => {
    setJoinOpen(open);
    if (!open) {
      setJoin(EMPTY_JOIN);
      setJoinError("");
      setJoinDone(false);
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

            <div className="mt-4 border-t pt-3 text-center">
              <button
                type="button"
                onClick={() => closeJoin(true)}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                هل تريد انضمام شركتك؟ قدِّم طلب انضمام
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          ConTrack V9.15 — إدارة العقود والمحاسبة
        </p>
      </div>

      {/* نافذة طلب الانضمام */}
      <Dialog open={joinOpen} onOpenChange={closeJoin}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>طلب انضمام شركة جديدة</DialogTitle>
            <DialogDescription>
              املأ البيانات وسيصل طلبكم إلى إدارة النظام للمراجعة — يُنشأ حسابكم بعد الموافقة ويصلكم اسم المستخدم وكلمة المرور.
            </DialogDescription>
          </DialogHeader>

          {joinDone ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center space-y-1">
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  تم استلام طلبكم بنجاح ✓
                </p>
                <p className="text-xs text-muted-foreground">
                  سيتم التواصل معكم بعد مراجعة الطلب. احتفظوا باسم المستخدم المطلوب:
                  <span dir="ltr" className="mx-1 font-mono font-bold text-foreground">{join.requestedUsername}</span>
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => closeJoin(false)}>إغلاق</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pe-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-name">اسم الشركة *</Label>
                    <Input
                      id="jn-name"
                      value={join.companyName}
                      onChange={(e) => setJoin((f) => ({ ...f, companyName: e.target.value }))}
                      placeholder="شركة ... "
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-short">الاختصار</Label>
                    <Input id="jn-short" value={join.shortName} onChange={(e) => setJoin((f) => ({ ...f, shortName: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-contact">مسؤول التواصل *</Label>
                    <Input id="jn-contact" value={join.contactName} onChange={(e) => setJoin((f) => ({ ...f, contactName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-phone">الهاتف</Label>
                    <Input id="jn-phone" dir="ltr" value={join.phone} onChange={(e) => setJoin((f) => ({ ...f, phone: e.target.value }))} placeholder="+965..." />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-email">البريد الإلكتروني</Label>
                    <Input id="jn-email" dir="ltr" type="email" value={join.email} onChange={(e) => setJoin((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-activity">نشاط الشركة</Label>
                    <Input id="jn-activity" value={join.activity} onChange={(e) => setJoin((f) => ({ ...f, activity: e.target.value }))} placeholder="مقاولات / تجارة / خدمات…" />
                  </div>
                </div>
                <div className="rounded-lg border bg-primary-soft/50 p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-primary-soft-foreground">حساب المدير — يُنشأ فور الموافقة على الطلب</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="jn-user" className="text-xs">اسم المستخدم المطلوب *</Label>
                      <Input
                        id="jn-user"
                        dir="ltr"
                        value={join.requestedUsername}
                        onChange={(e) => setJoin((f) => ({ ...f, requestedUsername: e.target.value }))}
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="jn-pass" className="text-xs">كلمة المرور *</Label>
                      <Input
                        id="jn-pass"
                        dir="ltr"
                        type="password"
                        value={join.password}
                        onChange={(e) => setJoin((f) => ({ ...f, password: e.target.value }))}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jn-confirm" className="text-xs">تأكيد كلمة المرور *</Label>
                    <Input
                      id="jn-confirm"
                      dir="ltr"
                      type="password"
                      value={join.confirm}
                      onChange={(e) => setJoin((f) => ({ ...f, confirm: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {joinError && (
                  <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
                    {joinError}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => closeJoin(false)}>إلغاء</Button>
                <Button onClick={submitJoin} disabled={joinLoading} className="gap-2">
                  {joinLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      جارٍ الإرسال…
                    </>
                  ) : (
                    <>
                      <Send className="size-4" />
                      إرسال الطلب
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
