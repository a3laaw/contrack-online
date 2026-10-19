"use client";

/**
 * المهمة — صفحة كاملة (بدل TaskDialog السابقة — 7 حقول):
 * نفس الحقول كلها ونفس الحفظ والتحقق والـpayload والـtoasts حرفيًا.
 * تُفتح من شاشة المهام («مهمة جديدة»/«تعديل») — بلا مسار جديد،
 * تُعرض مكان الشاشة المستدعية (استبدال في نفس المستوى) وتُركَّب عند الفتح فقط.
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
import type { CustomerDetailResponse, TaskItem } from "./contrack-types";
import { REMIND_OPTIONS, TASK_TYPES, errMessage } from "./contrack-types";

const NONE = "none";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm" → "YYYY-MM-DDTHH:mm" لحقل datetime-local */
function toLocalInput(s: string): string {
  return (s || "").slice(0, 16).replace(" ", "T");
}

/** "YYYY-MM-DDTHH:mm" → "YYYY-MM-DD HH:mm" لجسم الطلب */
function fromLocalInput(v: string): string {
  return (v || "").replace("T", " ");
}

/** افتراضي المهمة الجديدة: الساعة القادمة مقرّبة */
function defaultDueLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface TaskEditPageProps {
  /** مهمة للتعديل — null لإضافة مهمة جديدة */
  editing: TaskItem | null;
  onAuthError: () => void;
  /** بعد الحفظ الناجح (إبطال القوائم) */
  onSaved: () => void;
  /** العودة لشاشة المهام — تُستدعى بعد الحفظ أو عند الإلغاء */
  onClose: () => void;
}

export function TaskEditPage({ editing, onAuthError, onSaved, onClose }: TaskEditPageProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // الصفحة تُركَّب عند الفتح فقط — التهيئة مباشرة (تعديل → بيانات المهمة، إضافة → افتراضيات)
  const [title, setTitle] = React.useState(editing?.title || "");
  const [details, setDetails] = React.useState(editing?.details || "");
  const [due, setDue] = React.useState(editing ? toLocalInput(editing.dueAt) : defaultDueLocal());
  const [remind, setRemind] = React.useState(String(editing?.remindMinutes ?? 30));
  const [taskType, setTaskType] = React.useState<string>(editing?.taskType || "تذكير");
  const [customerId, setCustomerId] = React.useState(
    editing?.customerId != null ? String(editing.customerId) : NONE
  );
  const [contractId, setContractId] = React.useState(
    editing?.contractId != null ? String(editing.contractId) : NONE
  );
  const [formError, setFormError] = React.useState("");

  const customersQuery = useQuery<{ customers: { id: number; name: string }[] }>({
    queryKey: ["customers", ""],
    queryFn: () => apiGet<{ customers: { id: number; name: string }[] }>("/api/customers"),
  });

  const custContractsQuery = useQuery<CustomerDetailResponse>({
    queryKey: ["customer", customerId],
    queryFn: () => apiGet<CustomerDetailResponse>(`/api/customers/${customerId}`),
    enabled: customerId !== NONE,
  });
  const contractOptions = (custContractsQuery.data?.contracts ?? []).filter(
    (c) => c.status !== "ملغى"
  );

  // ===== نفس حفظ النافذة السابقة حرفيًا (نفس الـpayload والـtoasts) =====
  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? apiPatch<{ item?: TaskItem }>(`/api/tasks/${editing.id}`, body)
        : apiPost<{ item?: TaskItem }>("/api/tasks", body),
    onSuccess: () => {
      onSaved();
      onClose();
      toast({
        title: editing ? "حُدّثت المهمة" : "أُضيفت المهمة",
        description: editing ? "أُعيد جدولة تذكيراتها تلقائيًا" : "ستصلك تنبيهاتها في موعدها",
      });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      const msg = errMessage(e);
      setFormError(msg);
      toast({ variant: "destructive", title: "تعذر حفظ المهمة", description: msg });
    },
  });

  const submit = () => {
    setFormError("");
    if (!title.trim()) {
      setFormError("أدخل عنوان المهمة");
      return;
    }
    if (!due) {
      setFormError("حدد تاريخ ووقت الاستحقاق");
      return;
    }
    saveMutation.mutate({
      title: title.trim(),
      details: details.trim(),
      dueAt: fromLocalInput(due),
      remindMinutes: Number(remind) || 0,
      taskType,
      customerId: customerId !== NONE ? Number(customerId) : null,
      contractId: contractId !== NONE ? Number(contractId) : null,
    });
  };

  return (
    <div className="space-y-4">
      {/* ===== رأس الصفحة ===== */}
      <div>
        <p className="text-xs text-muted-foreground">المتابعة والتنسيق ← المهام</p>
        <h1 className="text-xl font-bold">{editing ? "تعديل مهمة" : "مهمة جديدة"}</h1>
        <p className="text-sm text-muted-foreground">
          {editing
            ? "عدّل بيانات المهمة — تُصفَّر أعلام التذكير عند الحفظ"
            : "حدد عنوان المهمة وموعدها وسيتم تذكيرك قبلها"}
        </p>
      </div>

      {/* ===== الحقول — نفس حقول النافذة السابقة كلها (7) ===== */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="task-title" className="text-xs">
                عنوان المهمة *
              </Label>
              <Input
                id="task-title"
                className="h-9"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: متابعة تسليم المستندات"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
              <Label htmlFor="task-details" className="text-xs">
                التفاصيل
              </Label>
              <Textarea
                id="task-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                placeholder="تفاصيل إضافية (اختياري)"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">النوع</Label>
              <Select value={taskType} onValueChange={setTaskType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">التذكير قبل</Label>
              <Select value={remind} onValueChange={setRemind}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due" className="text-xs">
                التاريخ والوقت *
              </Label>
              <Input
                id="task-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                dir="ltr"
                className="h-9 text-end"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">العميل (اختياري)</Label>
              <Select
                value={customerId}
                onValueChange={(v) => {
                  setCustomerId(v);
                  setContractId(NONE);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="بدون عميل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون عميل</SelectItem>
                  {(customersQuery.data?.customers ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">العقد (اختياري)</Label>
              <Select
                value={contractId}
                onValueChange={setContractId}
                disabled={customerId === NONE}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={customerId === NONE ? "اختر عميلًا أولًا" : "بدون عقد"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون عقد</SelectItem>
                  {contractOptions.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.contractNumber} — {c.contractName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button variant="outline" className="h-9" onClick={onClose} disabled={saveMutation.isPending}>
              إلغاء
            </Button>
            <Button className="h-9" onClick={submit} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {saveMutation.isPending ? "جارٍ الحفظ…" : editing ? "حفظ التعديلات" : "إضافة المهمة"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
