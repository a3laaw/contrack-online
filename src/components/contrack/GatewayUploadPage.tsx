"use client";

/**
 * صفحة «رفع ملف تسديد بوابة الدفع» — تحويل نافذة الرفع في GatewayView إلى صفحة كاملة.
 * نفس حقول النافذة والرفع والمعالجة (POST /api/gateway/settlement-file + الإضافة السريعة للبوابة) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة القائمة داخل GatewayView عبر حالة داخلية، وعند الانتهاء يعود لتبويب العمليات.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPost } from "./api";
import type { GatewayProfile, GatewaySettlementFileResult } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { formatKWD, round3 } from "@/lib/format";
import { parseOpsText } from "./GatewayFileParse";
import type { ParsedOp } from "./GatewayFileParse";

interface GatewayUploadPageProps {
  onAuthError: () => void;
  /** البوابات المفعلة (من استعلام profiles في GatewayView) */
  activeProfiles: GatewayProfile[];
  /** إبطال مفاتيح الكاش المشتركة كما في الشاشة الأم */
  invalidateAll: () => void;
  /** بعد نجاح المعالجة — يعود لتبويب العمليات */
  onDone: () => void;
  /** إلغاء — يعود لشاشة القائمة */
  onCancel: () => void;
}

export function GatewayUploadPage({
  onAuthError,
  activeProfiles,
  invalidateAll,
  onDone,
  onCancel,
}: GatewayUploadPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [uGateway, setUGateway] = React.useState(activeProfiles[0]?.name ?? "");
  const [uFileName, setUFileName] = React.useState("");
  const [uText, setUText] = React.useState("");
  const [uParsed, setUParsed] = React.useState<ParsedOp[]>([]);
  const [uError, setUError] = React.useState("");
  const [quickAdd, setQuickAdd] = React.useState(false);
  const [quickName, setQuickName] = React.useState("");

  const onUploadFile = async (file: File) => {
    try {
      const text = await file.text();
      setUFileName(file.name);
      setUText(text);
      setUError("");
      const rows = parseOpsText(text);
      setUParsed(rows);
      if (rows.length === 0) setUError("لم يُعثر على صفوف صالحة — تأكد من الأعمدة: تاريخ، هاتف، مبلغ، مرجع");
    } catch {
      setUError("تعذرت قراءة الملف");
    }
  };

  const settlementMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiPost<GatewaySettlementFileResult>("/api/gateway/settlement-file", body),
    onSuccess: (res) => {
      invalidateAll();
      toast({ title: "عولج الملف", description: `أُدرج ${res.inserted} صفًا ومطابقة ${res.matched}` });
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setUError(errMessage(e));
    },
  });

  const submitSettlement = () => {
    if (!uGateway.trim()) {
      setUError("اختر بوابة أو أضفها سريعًا");
      return;
    }
    if (uParsed.length === 0) {
      setUError("لا صفوف محللة — ارفع ملفًا أو الصق نصًا ثم حلّله");
      return;
    }
    setUError("");
    settlementMutation.mutate({
      gatewayName: uGateway.trim(),
      batch: uFileName || undefined,
      rows: uParsed.map((r) => ({
        opDate: r.opDate,
        phone: r.phone,
        amount: Number(r.amount),
        ref: r.ref || undefined,
      })),
    });
  };

  const quickAddMutation = useMutation({
    mutationFn: (name: string) => apiPost<{ profile?: GatewayProfile }>("/api/gateway/profiles", { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["gateway-profiles"] });
      const name = res.profile?.name ?? quickName.trim();
      setUGateway(name);
      setQuickAdd(false);
      setQuickName("");
      toast({ title: "أُضيفت البوابة", description: name });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setUError(errMessage(e));
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <header>
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>المحاسبة</span>
          <span aria-hidden="true">←</span>
          <span>بوابة الدفع</span>
          <span aria-hidden="true">←</span>
          <span className="font-medium text-foreground">رفع ملف تسديد</span>
        </nav>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
          <Upload className="size-5 text-primary" />
          رفع ملف تسديد بوابة الدفع
        </h1>
        <p className="text-sm text-muted-foreground">
          تحليل الملف ومطابقته آليًا بسندات القبض — التثبيت تراكمي ولا يمس الصفوف الموزعة/المسددة.
        </p>
      </header>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>البوابة *</Label>
              <div className="flex items-center gap-2">
                <Select value={uGateway || "none"} onValueChange={(v) => setUGateway(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="اختر البوابة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر —</SelectItem>
                    {activeProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                    {uGateway && !activeProfiles.some((p) => p.name === uGateway) && (
                      <SelectItem value={uGateway}>{uGateway}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1 self-start" onClick={() => setQuickAdd((s) => !s)}>
                <Plus className="size-3.5" />
                إضافة سريعة
              </Button>
              {quickAdd && (
                <div className="flex items-center gap-2">
                  <Input
                    className="h-9"
                    placeholder="اسم البوابة الجديدة"
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={quickAddMutation.isPending || !quickName.trim()}
                    onClick={() => quickAddMutation.mutate(quickName.trim())}
                  >
                    {quickAddMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                    حفظ
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>ملف نصي (CSV/TSV)</Label>
              <Input
                type="file"
                accept=".csv,.txt,.tsv,text/plain,text/csv"
                className="h-9"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUploadFile(f);
                }}
              />
              <p className="text-[11px] text-muted-foreground">يُحلل تلقائيًا بعد الاختيار (فاصلة/تاب/فاصلة منقوطة).</p>
            </div>

            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <div className="flex items-center gap-2 pt-1">
                <Label className="shrink-0">أو الصق النص الخام:</Label>
                {uText.trim() && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      const rows = parseOpsText(uText);
                      setUParsed(rows);
                      setUError(rows.length === 0 ? "لم يُعثر على صفوف صالحة — تأكد من الأعمدة: تاريخ، هاتف، مبلغ، مرجع" : "");
                    }}
                  >
                    تحليل النص
                  </Button>
                )}
              </div>
              <Textarea
                rows={5}
                className="font-mono text-xs"
                placeholder={"2025-01-15,9651234567,250.500,REF-001\n2025-01-15,9659876543,100.000"}
                value={uText}
                onChange={(e) => setUText(e.target.value)}
              />
            </div>
          </div>

          {uParsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold">
                  معاينة أول {Math.min(5, uParsed.length)} من {uParsed.length} صفًا (قابلة للتعديل)
                </span>
                <span className="text-muted-foreground">
                  المجموع: {formatKWD(round3(uParsed.reduce((s, r) => s + Number(r.amount || 0), 0)))}
                </span>
              </div>
              <div className="space-y-1.5">
                {uParsed.slice(0, 5).map((r, i) => (
                  <div key={i} className="grid grid-cols-4 gap-1.5">
                    <Input
                      className="h-8 text-xs"
                      value={r.opDate}
                      onChange={(e) => {
                        const next = [...uParsed];
                        next[i] = { ...r, opDate: e.target.value };
                        setUParsed(next);
                      }}
                      aria-label="التاريخ"
                    />
                    <Input
                      className="h-8 text-xs ltr text-start"
                      value={r.phone}
                      onChange={(e) => {
                        const next = [...uParsed];
                        next[i] = { ...r, phone: e.target.value };
                        setUParsed(next);
                      }}
                      aria-label="الهاتف"
                    />
                    <Input
                      className="h-8 text-xs ltr text-start"
                      value={r.amount}
                      onChange={(e) => {
                        const next = [...uParsed];
                        next[i] = { ...r, amount: e.target.value };
                        setUParsed(next);
                      }}
                      aria-label="المبلغ"
                    />
                    <Input
                      className="h-8 text-xs"
                      value={r.ref}
                      onChange={(e) => {
                        const next = [...uParsed];
                        next[i] = { ...r, ref: e.target.value };
                        setUParsed(next);
                      }}
                      aria-label="المرجع"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {uError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
              {uError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel} disabled={settlementMutation.isPending}>
              <ArrowRight className="size-4" />
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={settlementMutation.isPending || uParsed.length === 0}
              onClick={submitSettlement}
            >
              {settlementMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              معالجة ورفع ({uParsed.length})
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
