"use client";

import * as React from "react";
import {
  Loader2,
  FileSignature,
  Lock,
  User as UserIcon,
  Send,
  CheckCircle2,
  ArrowRight,
  HardHat,
  Package,
  Store,
  Wallet,
  Wrench,
  DraftingCompass,
  ShieldCheck,
  Info,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "./api";
import type { User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { MODULE_CATALOG, CORE_MODULE_CODE, moduleByCode } from "@/lib/modules-catalog";

/** خريطة أيقونات الكتالوج (الكتالوج نقي — الأيقونات هنا) */
const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  hardhat: HardHat,
  package: Package,
  store: Store,
  wrench: Wrench,
  compass: DraftingCompass,
};

interface LoginViewProps {
  onLoggedIn: (user: User, token: string, perms?: Record<string, boolean>) => void;
}

const EMPTY_JOIN = {
  companyName: "",
  shortName: "",
  contactName: "",
  phone: "",
  email: "",
  adminFullName: "",
  requestedUsername: "",
  password: "",
  confirm: "",
};

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // بوابة الانضمام (صفحة الزيارة الأولى) — takeover كامل بدل الحوار:
  // تُفتح من رابط صفحة الدخول أو مباشرة عبر ?join=1 (رابط قابل للمشاركة مع العملاء)
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [join, setJoin] = React.useState(EMPTY_JOIN);
  const [selected, setSelected] = React.useState<string[]>(["contracting"]); // الأنشطة المختارة
  const [joinError, setJoinError] = React.useState("");
  const [joinDone, setJoinDone] = React.useState<number | null>(null); // رقم الطلب المرجعي
  const [joinLoading, setJoinLoading] = React.useState(false);

  React.useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("join") === "1" || window.location.hash === "#join") setJoinOpen(true);
    } catch {
      /* لا شيء */
    }
  }, []);

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

  const toggleModule = (code: string) => {
    const def = moduleByCode(code);
    if (!def || def.core || !def.available) return; // الكور مشمول دائمًا و«قريبًا» غير قابل للاختيار
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const submitJoin = async () => {
    setJoinError("");
    if (selected.length === 0) {
      setJoinError("اختر نشاطًا واحدًا على الأقل");
      return;
    }
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
      const res = await apiPost<{ id: number }>("/api/register", {
        companyName: join.companyName.trim(),
        shortName: join.shortName.trim(),
        contactName: join.contactName.trim(),
        phone: join.phone.trim(),
        email: join.email.trim(),
        adminFullName: join.adminFullName.trim() || join.contactName.trim(),
        modules: selected,
        requestedUsername: join.requestedUsername.trim(),
        password: join.password,
      });
      setJoinDone(res.id);
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
      setSelected(["contracting"]);
      setJoinError("");
      setJoinDone(null);
      // تنظيف الرابط من ?join=1 حتى لا تعود البوابة عند تحديث الصفحة
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("join");
        window.history.replaceState(null, "", url.toString());
      } catch {
        /* لا شيء */
      }
    }
  };

  // ===== بوابة الانضمام — صفحة الزيارة الأولى الكاملة =====
  if (joinOpen) {
    const core = MODULE_CATALOG.find((m) => m.code === CORE_MODULE_CODE)!;
    const CoreIcon = MODULE_ICONS[core.icon] ?? Wallet;
    const selectable = MODULE_CATALOG.filter((m) => !m.core);

    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* ترويسة البوابة */}
        <header className="border-b bg-card">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileSignature className="size-5" />
              </span>
              <div className="leading-tight">
                <p className="text-base font-extrabold text-primary">ConTrack</p>
                <p className="text-[10px] text-muted-foreground">نظام إدارة العقود والمحاسبة — الكويت</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => closeJoin(false)}>
              <ArrowRight className="size-4" />
              تسجيل الدخول
            </Button>
          </div>
        </header>

        <main className="flex-1 w-full">
          <div className="mx-auto max-w-5xl px-4 py-6">
            {joinDone != null ? (
              /* ===== شاشة النجاح ===== */
              <div className="mx-auto max-w-md space-y-4 py-10 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-9" />
                </div>
                <h1 className="text-2xl font-extrabold">وصل طلبكم بنجاح</h1>
                <div className="rounded-xl border bg-card p-4 space-y-2 text-sm">
                  <p>
                    الرقم المرجعي:{" "}
                    <span dir="ltr" className="font-mono font-bold text-primary">
                      JR-{String(joinDone).padStart(5, "0")}
                    </span>{" "}
                    — احتفظوا به
                  </p>
                  <p className="text-muted-foreground">
                    سيراجع إدارة النظام الطلب ويُنشأ حسابكم بجميع ما اخترتم:
                    <span className="mx-1 font-bold text-foreground">
                      {selected.map((c) => moduleByCode(c)?.name).filter(Boolean).join(" + ")}
                    </span>
                    — ولكل نشاط قسمه الخاص عند أول دخول.
                  </p>
                </div>
                <Button variant="outline" onClick={() => closeJoin(false)}>
                  العودة لتسجيل الدخول
                </Button>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                {/* ===== الأقسام ===== */}
                <div className="space-y-6 min-w-0">
                  {/* ① الأنشطة */}
                  <section aria-labelledby="join-sec-1" className="space-y-3">
                    <div>
                      <h2 id="join-sec-1" className="text-lg font-bold">
                        <span className="me-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                        أنشطتكم — اختروا واحدًا أو أكثر
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        تفتحون شركتكم بنشاط وتضيفون عليه وقتما شئتم — المحاسبة والخزينة مشمولة تلقائيًا مع كل نشاط
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectable.map((m) => {
                        const Icon = MODULE_ICONS[m.icon] ?? Package;
                        const isOn = selected.includes(m.code);
                        return (
                          <button
                            key={m.code}
                            type="button"
                            onClick={() => toggleModule(m.code)}
                            disabled={!m.available}
                            aria-pressed={isOn}
                            className={
                              isOn
                                ? "rounded-xl border-2 border-primary bg-primary-soft/60 p-4 text-start transition-all shadow-sm"
                                : m.available
                                  ? "rounded-xl border bg-card p-4 text-start transition-all hover:border-primary/50 hover:shadow-sm"
                                  : "rounded-xl border bg-muted/30 p-4 text-start opacity-70 cursor-not-allowed"
                            }
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className={`flex size-10 items-center justify-center rounded-lg ${isOn ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                                <Icon className="size-5" />
                              </span>
                              {m.available ? (
                                isOn ? (
                                  <Badge className="gap-1 bg-primary text-primary-foreground">
                                    <CheckCircle2 className="size-3" />
                                    مختار
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">متاح</Badge>
                                )
                              ) : (
                                <Badge variant="outline" className="text-[10px]">قريبًا</Badge>
                              )}
                            </div>
                            <p className="mt-3 font-bold">{m.name}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                    {/* بطاقة الكور — مشمولة تلقائيًا */}
                    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 p-4">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                        <CoreIcon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-bold">
                          {core.name}
                          <Badge variant="secondary" className="gap-0.5 text-[10px]">
                            <Lock className="size-2.5" />
                            مشمولة تلقائيًا
                          </Badge>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{core.desc}</p>
                      </div>
                      <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    </div>
                  </section>

                  {/* ② بيانات الشركة */}
                  <section aria-labelledby="join-sec-2" className="space-y-3">
                    <h2 id="join-sec-2" className="text-lg font-bold">
                      <span className="me-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      بيانات شركتكم
                    </h2>
                    <div className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-name">اسم الشركة *</Label>
                        <Input
                          id="jn-name"
                          value={join.companyName}
                          onChange={(e) => setJoin((f) => ({ ...f, companyName: e.target.value }))}
                          placeholder="شركة ..."
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-short">الاختصار</Label>
                        <Input id="jn-short" value={join.shortName} onChange={(e) => setJoin((f) => ({ ...f, shortName: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-contact">مسؤول التواصل *</Label>
                        <Input id="jn-contact" value={join.contactName} onChange={(e) => setJoin((f) => ({ ...f, contactName: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-phone">الهاتف</Label>
                        <Input id="jn-phone" dir="ltr" value={join.phone} onChange={(e) => setJoin((f) => ({ ...f, phone: e.target.value }))} placeholder="+965..." />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="jn-email">البريد الإلكتروني</Label>
                        <Input id="jn-email" dir="ltr" type="email" value={join.email} onChange={(e) => setJoin((f) => ({ ...f, email: e.target.value }))} />
                      </div>
                    </div>
                  </section>

                  {/* ③ حساب المدير */}
                  <section aria-labelledby="join-sec-3" className="space-y-3">
                    <h2 id="join-sec-3" className="text-lg font-bold">
                      <span className="me-2 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      حساب مدير الشركة
                    </h2>
                    <div className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-admin-name">اسم المدير *</Label>
                        <Input
                          id="jn-admin-name"
                          value={join.adminFullName}
                          onChange={(e) => setJoin((f) => ({ ...f, adminFullName: e.target.value }))}
                          placeholder="اسم صاحب الشركة أو المدير"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-user">اسم المستخدم المطلوب *</Label>
                        <Input
                          id="jn-user"
                          dir="ltr"
                          value={join.requestedUsername}
                          onChange={(e) => setJoin((f) => ({ ...f, requestedUsername: e.target.value }))}
                          placeholder="3 أحرف على الأقل — إنجليزي"
                          autoComplete="off"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-pass">كلمة المرور *</Label>
                        <Input
                          id="jn-pass"
                          dir="ltr"
                          type="password"
                          value={join.password}
                          onChange={(e) => setJoin((f) => ({ ...f, password: e.target.value }))}
                          placeholder="6 أحرف على الأقل"
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="jn-confirm">تأكيد كلمة المرور *</Label>
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
                  </section>

                  {joinError && (
                    <p role="alert" className="rounded-md bg-status-danger-bg px-3 py-2 text-sm text-status-danger">
                      {joinError}
                    </p>
                  )}
                </div>

                {/* ===== ملخص الطلب — ثابت جانبيًا (سطح المكتب) ===== */}
                <aside className="hidden lg:block">
                  <div className="sticky top-6 space-y-3 rounded-xl border bg-card p-4">
                    <p className="text-sm font-bold">⚑ ملخص طلبكم</p>
                    <div className="space-y-1.5 text-sm">
                      <p className="text-muted-foreground">
                        الأنشطة: <span className="font-bold text-foreground tabular-nums">{selected.length}</span>
                      </p>
                      <ul className="space-y-1">
                        {selected.map((c) => (
                          <li key={c} className="flex items-center gap-1.5 text-xs font-medium">
                            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            {moduleByCode(c)?.name}
                          </li>
                        ))}
                      </ul>
                      <p className="rounded-md bg-primary-soft/60 px-2 py-1.5 text-[11px] text-primary-soft-foreground">
                        تجربة مجانية 14 يومًا تشمل كل ما اخترتم — الحدود تُطبق عند الاشتراك الفعلي
                      </p>
                    </div>
                    <Button className="w-full gap-2" onClick={submitJoin} disabled={joinLoading || selected.length === 0}>
                      {joinLoading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          جارٍ الإرسال…
                        </>
                      ) : (
                        <>
                          <Send className="size-4" />
                          قدِّم طلب الانضمام
                        </>
                      )}
                    </Button>
                    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Info className="mt-0.5 size-3 shrink-0" />
                      طلبكم لا ينشئ شيئًا قبل موافقة إدارة النظام — بياناتكم محمية ولا تُشارك مع أحد
                    </p>
                  </div>
                </aside>
              </div>
            )}
          </div>
        </main>

        {/* شريط التقديم السفلي — الموبايل */}
        {joinDone == null && (
          <div className="sticky bottom-0 border-t bg-card p-3 lg:hidden" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-xs text-muted-foreground">
                الأنشطة: <span className="font-bold text-foreground tabular-nums">{selected.length}</span>
                {selected.length > 0 && ` — ${selected.map((c) => moduleByCode(c)?.name).filter(Boolean).join(" + ")}`}
              </span>
              <Button onClick={submitJoin} disabled={joinLoading || selected.length === 0} className="gap-2">
                {joinLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                تقديم
              </Button>
            </div>
          </div>
        )}

        <footer className="border-t bg-muted/40">
          <div className="mx-auto max-w-5xl px-4 py-2 text-center text-xs text-muted-foreground">
            ConTrack V9.15 — إدارة العقود والمحاسبة
          </div>
        </footer>
      </div>
    );
  }

  // ===== شاشة تسجيل الدخول =====
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
    </div>
  );
}
