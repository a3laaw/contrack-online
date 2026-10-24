"use client";

/**
 * المقاول — صفحة كاملة (بدل نافذة إضافة/تعديل المقاول السابقة — 5 حقول):
 * نفس الحقول كلها ونفس الحفظ والـpayload والـinvalidations والـtoasts حرفيًا.
 * تُفتح من شاشة مقاولي الباطن («مقاول جديد»/«تعديل») — بلا مسار جديد،
 * تُعرض مكان الشاشة المستدعية (استبدال في نفس المستوى) وتُركَّب عند الفتح فقط.
 */

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiPatch, apiPost } from "./api";
import type { SubContractor } from "./contrack-types";
import { errMessage } from "./contrack-types";

interface ContractorEditPageProps {
  /** مقاول للتعديل — null لإضافة مقاول جديد */
  editing: SubContractor | null;
  onAuthError: () => void;
  /** بعد الحفظ الناجح (إبطال القوائم) */
  onSaved: () => void;
  /** العودة لشاشة المقاولين — تُستدعى بعد الحفظ أو عند الإلغاء */
  onClose: () => void;
}

export function ContractorEditPage({ editing, onAuthError, onSaved, onClose }: ContractorEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (نفس تهيئة openForm السابقة)
  const [name, setName] = React.useState(editing?.name || "");
  const [phone, setPhone] = React.useState(editing?.phone || "");
  const [email, setEmail] = React.useState(editing?.email || "");
  const [activity, setActivity] = React.useState(editing?.activity || "");
  const [notes, setNotes] = React.useState(editing?.notes || "");

  // ===== نفس حفظ النافذة السابقة حرفيًا (نفس الـpayload والـinvalidations والـtoasts) =====
  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        activity: activity.trim(),
        notes: notes.trim(),
      };
      return editing
        ? apiPatch(`/api/subcontractors/${editing.id}`, body)
        : apiPost("/api/subcontractors", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
      qc.invalidateQueries({ queryKey: ["subcontractor"] });
      qc.invalidateQueries({ queryKey: ["sub-contracts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: editing ? "تم التعديل" : "تمت الإضافة",
        description: editing ? "حُدّثت بيانات المقاول" : "أُضيف المقاول بنجاح",
      });
      onSaved();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({
        variant: "destructive",
        title: editing ? "تعذر التعديل" : "تعذرت الإضافة",
        description: errMessage(e),
      });
    },
  });

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">العملاء والعقود ← مقاولو الباطن</p>
        <h1 className="text-xl font-bold">{editing ? "تعديل مقاول" : "مقاول جديد"}</h1>
        <p className="text-sm text-muted-foreground">الاسم مطلوب، والباقي اختياري.</p>
      </div>

      {/* ===== الحقول — نفس حقول النافذة السابقة كلها (5) ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="sc-name" className="text-xs">
                الاسم *
              </Label>
              <Input id="sc-name" className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-phone" className="text-xs">
                الهاتف
              </Label>
              <Input
                id="sc-phone"
                className="h-9"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-email" className="text-xs">
                البريد الإلكتروني
              </Label>
              <Input
                id="sc-email"
                className="h-9"
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="sc-activity" className="text-xs">
                النشاط
              </Label>
              <Input
                id="sc-activity"
                className="h-9"
                placeholder="مثال: أعمال كهرباء"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="sc-notes" className="text-xs">
                ملاحظات
              </Label>
              <Textarea id="sc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== شريط الإجراءات السفلي — حفظ أساسي واحد + إلغاء outline ===== */}
      <div className="sticky bottom-0 z-30">
        <Card className="border bg-background/95 shadow-sm backdrop-blur">
          <CardContent className="flex items-center justify-end gap-2 p-2">
            <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
              إلغاء
            </Button>
            <Button
              className="h-9"
              disabled={saveMutation.isPending || !name.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {saveMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
