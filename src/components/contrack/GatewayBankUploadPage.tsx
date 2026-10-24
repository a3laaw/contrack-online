"use client";

/**
 * صفحة «رفع كشف حساب البنك» — تحويل نافذة رفع كشف البنك في GatewayView إلى صفحة كاملة.
 * نفس حقول النافذة والرفع والمعالجة (POST /api/gateway/bank-lines) حرفيًا — لا تغيير منطق أعمال.
 * لا مسار جديد — تُعرض مكان شاشة القائمة داخل GatewayView عبر حالة داخلية.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Landmark, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPost } from "./api";
import { errMessage } from "./contrack-types";
import { parseBankText } from "./GatewayFileParse";
import type { ParsedBankLine } from "./GatewayFileParse";

interface GatewayBankUploadPageProps {
  onAuthError: () => void;
  /** بعد نجاح الحفظ — يعود لتبويب التصفية اليومية (قسم سطور البنك) */
  onDone: () => void;
  /** إلغاء — يعود لشاشة القائمة */
  onCancel: () => void;
}

export function GatewayBankUploadPage({ onAuthError, onDone, onCancel }: GatewayBankUploadPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [bText, setBText] = React.useState("");
  const [bParsed, setBParsed] = React.useState<ParsedBankLine[]>([]);
  const [bError, setBError] = React.useState("");

  const bankUploadMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost("/api/gateway/bank-lines", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gateway-bank-lines"] });
      qc.invalidateQueries({ queryKey: ["gateway-unmatched-bank"] });
      qc.invalidateQueries({ queryKey: ["gateway-clearing"] });
      onDone();
      toast({ title: "حُفظت سطور البنك", description: `${bParsed.length} سطر إيداع` });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      setBError(errMessage(e));
    },
  });

  const submitBankUpload = () => {
    if (bParsed.length === 0) {
      setBError("لا سطور محللة — ارفع ملفًا أو الصق نصًا ثم حلّله");
      return;
    }
    setBError("");
    bankUploadMutation.mutate({
      rows: bParsed.map((r) => ({ cdate: r.cdate, amount: Number(r.amount), descr: r.descr || undefined })),
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
          <span className="font-medium text-foreground">رفع كشف بنك</span>
        </nav>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
          <Landmark className="size-5 text-primary" />
          رفع كشف حساب البنك
        </h1>
        <p className="text-sm text-muted-foreground">
          استخراج الإيداعات فقط (تاريخ/مبلغ/وصف) بنفس تحليل الملفات النصية — تُستخدم في التصفية اليومية.
        </p>
      </header>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>ملف كشف الحساب (CSV/TSV)</Label>
              <Input
                type="file"
                accept=".csv,.txt,.tsv,text/plain,text/csv"
                className="h-9"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const text = await f.text();
                    setBText(text);
                    const rows = parseBankText(text);
                    setBParsed(rows);
                    setBError(rows.length === 0 ? "لم يُعثر على سطور إيداع صالحة" : "");
                  } catch {
                    setBError("تعذرت قراءة الملف");
                  }
                }}
              />
              {bText.trim() && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs self-start"
                  onClick={() => {
                    const rows = parseBankText(bText);
                    setBParsed(rows);
                    setBError(rows.length === 0 ? "لم يُعثر على سطور إيداع صالحة" : "");
                  }}
                >
                  تحليل النص
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">يُحلل تلقائيًا بعد الاختيار — إيداعات فقط.</p>
            </div>

            <div className="space-y-1.5 md:col-span-1 lg:col-span-2">
              <Label>أو الصق النص الخام:</Label>
              <Textarea
                rows={5}
                className="font-mono text-xs"
                placeholder={"2025-01-16,1250.500,إيداع شبكة\n2025-01-17,300.000"}
                value={bText}
                onChange={(e) => setBText(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {bParsed.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold">
                  معاينة أول {Math.min(5, bParsed.length)} من {bParsed.length} سطرًا
                </div>
                {bParsed.slice(0, 5).map((r, i) => (
                  <div key={i} className="grid grid-cols-3 gap-1.5">
                    <Input
                      className="h-8 text-xs"
                      value={r.cdate}
                      onChange={(e) => {
                        const next = [...bParsed];
                        next[i] = { ...r, cdate: e.target.value };
                        setBParsed(next);
                      }}
                      aria-label="التاريخ"
                    />
                    <Input
                      className="h-8 text-xs ltr text-start"
                      value={r.amount}
                      onChange={(e) => {
                        const next = [...bParsed];
                        next[i] = { ...r, amount: e.target.value };
                        setBParsed(next);
                      }}
                      aria-label="المبلغ"
                    />
                    <Input
                      className="h-8 text-xs"
                      value={r.descr}
                      onChange={(e) => {
                        const next = [...bParsed];
                        next[i] = { ...r, descr: e.target.value };
                        setBParsed(next);
                      }}
                      aria-label="الوصف"
                    />
                  </div>
                ))}
              </div>
            )}
            {bError && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs font-semibold text-destructive">
                {bError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9 gap-1.5" onClick={onCancel} disabled={bankUploadMutation.isPending}>
              <ArrowRight className="size-4" />
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={bankUploadMutation.isPending || bParsed.length === 0}
              onClick={submitBankUpload}
            >
              {bankUploadMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              حفظ سطور البنك ({bParsed.length})
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
