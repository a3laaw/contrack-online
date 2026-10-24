"use client";

/**
 * صفحة «إضافة/تعديل بوابة (profile)» — تحويل نافذة الإعدادات في GatewayView إلى صفحة كاملة.
 * نفس حقول النافذة الثمانية والحفظ (POST /api/gateway/profiles أو PATCH …/[id]) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة القائمة داخل GatewayView عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPatch, apiPost } from "./api";
import type { GatewayProfile } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface GatewayProfileEditPageProps {
  onAuthError: () => void;
  /** البوابة قيد التعديل — null للبوابة الجديدة */
  editing: GatewayProfile | null;
  /** بعد الحفظ الناجح — يعود لتبويب الإعدادات */
  onSaved: () => void;
  /** إلغاء — يعود لشاشة القائمة */
  onCancel: () => void;
}

export function GatewayProfileEditPage({
  onAuthError,
  editing,
  onSaved,
  onCancel,
}: GatewayProfileEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // تهيئة الحقول من البوابة قيد التعديل (كما كانت openProfileEdit/openProfileNew) — الصفحة تُركَّب عند الفتح فقط
  const [pName, setPName] = React.useState(editing?.name ?? "");
  const [pBank, setPBank] = React.useState(editing?.bankAccount ?? "");
  const [pMethods, setPMethods] = React.useState(editing?.methods ?? "");
  const [pLag, setPLag] = React.useState(String(editing?.lagDays ?? 1));
  const [pFee, setPFee] = React.useState(String(editing?.feeFixed ?? 0));
  const [pTolerance, setPTolerance] = React.useState(String(editing?.tolerance ?? 0.005));
  const [pLate, setPLate] = React.useState(String(editing?.lateDays ?? 3));
  const [pActive, setPActive] = React.useState(editing?.isActive ?? true);
  const [profileError, setProfileError] = React.useState("");

  const profileSaveMutation = useMutation({
    mutationFn: (vars: { id?: number; body: Record<string, unknown> }) =>
      vars.id
        ? apiPatch(`/api/gateway/profiles/${vars.id}`, vars.body)
        : apiPost("/api/gateway/profiles", vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-profiles"] });
      toast({ title: editing ? "عُدلت البوابة" : "أُضيفت البوابة" });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setProfileError(errMessage(e));
    },
  });

  const submitProfile = () => {
    if (!pName.trim()) {
      setProfileError("اسم البوابة مطلوب");
      return;
    }
    setProfileError("");
    profileSaveMutation.mutate({
      id: editing?.id,
      body: {
        name: pName.trim(),
        bankAccount: pBank.trim() || undefined,
        methods: pMethods.trim() || undefined,
        lagDays: Number(pLag) || 0,
        feeFixed: Number(pFee) || 0,
        tolerance: Number(pTolerance) || 0,
        lateDays: Number(pLate) || 0,
        isActive: pActive,
      },
    });
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>المحاسبة</span>
          <span aria-hidden="true">←</span>
          <span>بوابة الدفع</span>
          <span aria-hidden="true">←</span>
          <span className="font-medium text-foreground">{editing ? "تعديل بوابة" : "بوابة جديدة"}</span>
        </nav>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
          <CreditCard className="size-5 text-primary" />
          {editing ? `تعديل البوابة: ${editing.name}` : "بوابة جديدة"}
        </h1>
        <p className="text-sm text-muted-foreground">
          طرق الدفع كلمات مفصولة بفوترة تُطابَق على سندات القبض — T+N أيام التأجيل وحد التحمّل للمبالغ.
        </p>
      </header>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>اسم البوابة *</Label>
              <Input className="h-9" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Hesabe / KNET…" />
            </div>
            <div className="space-y-1.5">
              <Label>الحساب البنكي</Label>
              <Input className="h-9" value={pBank} onChange={(e) => setPBank(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label>طرق الدفع (مفصولة بفاصلة)</Label>
              <Input className="h-9" value={pMethods} onChange={(e) => setPMethods(e.target.value)} placeholder="KNET, Hesabe" />
            </div>
            <div className="space-y-1.5">
              <Label>التأجيل T+N (أيام)</Label>
              <Input className="h-9 ltr text-start" inputMode="numeric" value={pLag} onChange={(e) => setPLag(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>العمولة %</Label>
              <Input className="h-9 ltr text-start" inputMode="decimal" value={pFee} onChange={(e) => setPFee(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>حد التحمّل</Label>
              <Input
                className="h-9 ltr text-start"
                inputMode="decimal"
                value={pTolerance}
                onChange={(e) => setPTolerance(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>أيام التأخير</Label>
              <Input className="h-9 ltr text-start" inputMode="numeric" value={pLate} onChange={(e) => setPLate(e.target.value)} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm md:col-span-2 lg:col-span-3">
              <Checkbox checked={pActive} onCheckedChange={(v) => setPActive(v === true)} />
              مفعلة
            </label>
          </div>
          {profileError && (
            <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {profileError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel} disabled={profileSaveMutation.isPending}>
              <ArrowRight className="size-4" />
              إلغاء
            </Button>
            <Button className="h-9" disabled={profileSaveMutation.isPending} onClick={submitProfile}>
              {profileSaveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
