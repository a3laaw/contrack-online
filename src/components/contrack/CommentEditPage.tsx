"use client";

/**
 * التعليق — صفحة كاملة واحدة تخدم وضعين (بدل نافذتين سابقتين):
 *  - mode "new": «تعليق جديد» — 7 حقول (نافذة NewCommentDialog السابقة حرفيًا).
 *  - mode "meta": «تعديل بيانات التعليق» — 5 حقول (نافذة MetaDialog السابقة حرفيًا).
 * نفس الحفظ والتحقق والـpayload والـtoasts حرفيًا. «تعديل نص التعليق» (حقل 1) بقيت نافذة.
 * تُفتح من شاشة التعليقات — بلا مسار جديد، تُعرض مكان الشاشة المستدعية وتُركَّب عند الفتح فقط.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

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
import { ApiError, apiGet, apiPatch, apiPost } from "./api";
import { SearchableSelect } from "./SearchableSelect";
import type { CommentItem, CustomerDetailResponse } from "./contrack-types";
import {
  COMMENT_KINDS,
  COMMENT_PRIORITIES,
  COMMENT_STATUSES,
  errMessage,
} from "./contrack-types";
import { cn } from "@/lib/utils";

const NONE = "none";
const MAX_BODY = 2000;

function parseTags(s: string): string[] {
  return (s || "")
    .split(/[,،]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

interface CommentEditPageProps {
  mode: "new" | "meta";
  /** تعليق الهدف في وضع meta — يُهمل في وضع new */
  target?: CommentItem | null;
  onAuthError: () => void;
  /** بعد الحفظ الناجح (إبطال القوائم) */
  onSaved: () => void;
  /** العودة لشاشة التعليقات — تُستدعى بعد الحفظ أو عند الإلغاء */
  onClose: () => void;
}

export function CommentEditPage({ mode, target, onAuthError, onSaved, onClose }: CommentEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isMeta = mode === "meta";

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (نفس تهيئة النافذتين السابقتين عند الفتح)
  const [customerId, setCustomerId] = React.useState(NONE);
  const [contractId, setContractId] = React.useState(NONE);
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<string>(target?.kind || "عام");
  const [priority, setPriority] = React.useState<string>(target?.priority || "عادي");
  const [tags, setTags] = React.useState(target?.tags || "");
  const [followupDate, setFollowupDate] = React.useState(target?.followupDate || "");
  const [status, setStatus] = React.useState(target?.status || "مفتوح");
  const [formError, setFormError] = React.useState("");

  const customersQuery = useQuery<{ customers: { id: number; name: string }[] }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: { id: number; name: string }[] }>("/api/customers"),
    enabled: !isMeta,
  });

  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", customerId],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${customerId}`),
    enabled: !isMeta && customerId !== NONE,
  });
  const contractOptions = (custContractsQuery.data?.contracts ?? []).filter(
    (c) => c.status !== "ملغى"
  );

  // ===== نفس إنشاء النافذة السابقة حرفيًا (نفس الـpayload والـtoasts) =====
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost<{ item?: CommentItem }>("/api/comments", payload),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: "أُضيف التعليق", description: "ظهر في مركز التعليقات وملف العميل" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر إضافة التعليق", description: msg });
    },
  });

  // ===== نفس تعديل البيانات (meta) حرفيًا =====
  const metaMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiPatch<{ item?: CommentItem }>(`/api/comments/${target?.id}`, { action: "meta", ...payload }),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({ title: "حُدّثت بيانات التعليق" });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر التحديث", description: msg });
    },
  });

  const submit = () => {
    setFormError("");
    if (isMeta) {
      metaMutation.mutate({
        status,
        kind,
        priority,
        tags: parseTags(tags).join("،"),
        followupDate,
      });
      return;
    }
    if (customerId === NONE) {
      setFormError("اختر العميل — التعليق مرتبط بعميل دائمًا");
      return;
    }
    const text = body.trim();
    if (!text) {
      setFormError("اكتب نص التعليق");
      return;
    }
    if (text.length > MAX_BODY) {
      setFormError(`النص يتجاوز ${MAX_BODY} حرفًا`);
      return;
    }
    createMutation.mutate({
      customerId: Number(customerId),
      contractId: contractId !== NONE ? Number(contractId) : undefined,
      body: text,
      kind,
      priority,
      tags: parseTags(tags).join("،"),
      followupDate,
    });
  };

  const pending = isMeta ? metaMutation.isPending : createMutation.isPending;

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">المتابعة والتنسيق ← التعليقات</p>
        <h1 className="text-xl font-bold">{isMeta ? "تعديل بيانات التعليق" : "تعليق جديد"}</h1>
        <p className="text-sm text-muted-foreground">
          {isMeta
            ? "الحالة والنوع والأولوية والوسوم ومتابعة — النص يُعدَّل من زره"
            : "ملاحظة مرتبطة بعميل (وعقد اختياري) تظهر في مركز التعليقات"}
        </p>
      </div>

      {/* ===== الحقول — وضع new: 7 حقول / وضع meta: 5 حقول (كالنوافذ السابقة) ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* — حقول التعليق الجديد — */}
            {!isMeta && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">العميل *</Label>
                  <SearchableSelect
                    value={customerId}
                    onValueChange={(v) => {
                      setCustomerId(v);
                      setContractId(NONE);
                    }}
                    options={(customersQuery.data?.customers ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="اختر العميل"
                    searchPlaceholder="ابحث بالاسم…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">العقد (اختياري)</Label>
                  <SearchableSelect
                    value={contractId}
                    onValueChange={setContractId}
                    disabled={customerId === NONE}
                    options={[
                      { value: NONE, label: "بدون عقد" },
                      ...contractOptions.map((c) => ({ value: String(c.id), label: `${c.contractNumber} — ${c.contractName}` })),
                    ]}
                    placeholder={customerId === NONE ? "اختر عميلًا أولًا" : "بدون عقد"}
                    searchPlaceholder="ابحث برقم/اسم العقد…"
                    emptyText="لا نتائج مطابقة"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="comment-body" className="text-xs">
                      النص *
                    </Label>
                    <span
                      className={cn(
                        "text-[11px] tabular-nums",
                        body.length > MAX_BODY ? "font-bold text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {body.length}/{MAX_BODY}
                    </span>
                  </div>
                  <Textarea
                    id="comment-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={4}
                    maxLength={MAX_BODY + 50}
                    placeholder="اكتب التعليق…"
                  />
                </div>
              </>
            )}

            {/* — حقول مشتركة (النوع/الأولوية) — */}
            <div className="space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* — حالة (meta فقط) — */}
            {isMeta && (
              <div className="space-y-1.5">
                <Label className="text-xs">الحالة</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* — وسوم ومتابعة (مشتركة) — */}
            <div className="space-y-1.5">
              <Label htmlFor="comment-tags" className="text-xs">
                وسوم (فاصلة بينها)
              </Label>
              <Input
                id="comment-tags"
                className="h-9"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="مثال: مستندات، متابعة"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="comment-followup" className="text-xs">
                تاريخ المتابعة
              </Label>
              <Input
                id="comment-followup"
                className="h-9"
                type="date"
                value={followupDate}
                onChange={(e) => setFollowupDate(e.target.value)}
              />
            </div>

            {formError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive md:col-span-2 lg:col-span-3">
                {formError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — حفظ أساسي واحد + إلغاء outline ===== */}
      <div className="sticky bottom-2 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onClose} disabled={pending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? "جارٍ الحفظ…" : isMeta ? "حفظ" : "إضافة التعليق"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
