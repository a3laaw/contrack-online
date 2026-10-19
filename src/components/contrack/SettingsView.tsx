"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  DatabaseBackup,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserCog,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type { PaymentMethodDTO, PaymentMethodsResponse, SettingsDTO, SettingsResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { ContractTypesManager } from "./ContractTypesManager";

interface SettingsViewProps {
  user: User;
  onAuthError: () => void;
  /** القسم المبدئي من القائمة الجانبية (قيمة تبويب داخلي: company/appearance/security/…) */
  initialSection?: string;
}

/** إعدادات النموذج — تشمل حقول النسخ التلقائي الموجودة في الخادم */
type SettingsFormDTO = SettingsDTO & {
  autoBackupEnabled?: boolean;
  autoBackupInterval?: number;
};

// ===================================================================
// الإعدادات — تبويبات المكتبي الحرفية (settings.py):
// بيانات الشركة · الطباعة والعرض · الأمان والمستخدمون/كلمة المرور ·
// أنواع العقود · حسابات المصروفات · مراحل المتابعة · جدول الزيارات ·
// البيانات والنسخ الاحتياطي · أدوات المطور (developer فقط).
// ===================================================================

export function SettingsView({ user, onAuthError, initialSection }: SettingsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const manager = user.role === "admin" || user.role === "developer";
  const isDeveloper = user.role === "developer";

  // القسم النشط — يقوده اختيار القائمة الجانبية (قيد 2: أقسام لا تبويبات متراكمة)
  const [tab, setTab] = React.useState(initialSection || (manager ? "company" : "appearance"));
  React.useEffect(() => {
    if (initialSection) setTab(initialSection);
  }, [initialSection]);

  const settingsQuery = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsResponse>("/api/settings"),
    enabled: manager,
  });

  const methodsQuery = useQuery<PaymentMethodsResponse>({
    queryKey: ["payment-methods"],
    queryFn: () => apiGet<PaymentMethodsResponse>("/api/payment-methods"),
    enabled: manager,
  });

  const [form, setForm] = React.useState<SettingsFormDTO | null>(null);
  React.useEffect(() => {
    if (settingsQuery.data?.settings) setForm(settingsQuery.data.settings as SettingsFormDTO);
  }, [settingsQuery.data]);

  const fail = React.useCallback(
    (e: unknown, title: string) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title, description: errMessage(e) });
    },
    [onAuthError, toast]
  );

  const saveMutation = useMutation({
    mutationFn: () => apiPut<{ settings: SettingsFormDTO }>("/api/settings", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "تم الحفظ", description: "حُفظت الإعدادات بنجاح" });
    },
    onError: (e) => fail(e, "تعذر حفظ الإعدادات"),
  });

  const upd = (patch: Partial<SettingsFormDTO>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">الإعدادات</h1>
          <p className="text-sm text-muted-foreground">بيانات الشركة والإعدادات المالية وأساليب الدفع</p>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v)}
        className="gap-4"
      >
        {/* الأقسام تقودها القائمة الجانبية للوحدة (قيد 2: لا تبويبات متراكمة) */}
        <p className="sr-only">القسم الحالي يُختار من القائمة الجانبية</p>

        {/* ===== 1) بيانات الشركة (مدير) ===== */}
        {manager && (
          <TabsContent value="company" className="space-y-4">
            {settingsQuery.isLoading || !form ? (
              <SettingsSkeleton />
            ) : settingsQuery.isError ? (
              <Card className="border-status-danger/40">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">{errMessage(settingsQuery.error)}</CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">بيانات الشركة</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="s-company">اسم الشركة</Label>
                      <Input id="s-company" className="h-9" value={form.companyName} onChange={(e) => upd({ companyName: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="s-currency">العملة</Label>
                      <Input id="s-currency" className="h-9" value={form.currency} onChange={(e) => upd({ currency: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="s-phone">الهاتف</Label>
                      <Input id="s-phone" className="h-9" dir="ltr" value={form.companyPhone} onChange={(e) => upd({ companyPhone: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="s-email">البريد الإلكتروني</Label>
                      <Input id="s-email" className="h-9" dir="ltr" type="email" value={form.companyEmail} onChange={(e) => upd({ companyEmail: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="s-address">العنوان</Label>
                      <Input id="s-address" className="h-9" value={form.companyAddress} onChange={(e) => upd({ companyAddress: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="s-header">نص هيدر النظام</Label>
                      <Input
                        id="s-header"
                        className="h-9"
                        placeholder="نظام إدارة العقود والمحاسبة"
                        value={form.headerTitle ?? ""}
                        onChange={(e) => upd({ headerTitle: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        يظهر كنص هيدر في أعلى شاشات النظام ويُستخدم كعنوان افتراضي في المطبوعات عند الحاجة
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">الإعدادات المالية</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="text-sm font-medium">رسوم البنك</div>
                          <div className="text-xs text-muted-foreground">تفعيل احتساب رسوم على سندات القبض</div>
                        </div>
                        <Switch checked={form.bankFeeEnabled} onCheckedChange={(v) => upd({ bankFeeEnabled: v })} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <div className="text-sm font-medium">بوابة صرف الباطن</div>
                          <div className="text-xs text-muted-foreground">إيقاف خط الباطن حتى تحصيل دفعة العميل (subPayClientGate)</div>
                        </div>
                        <Switch checked={form.subPayClientGate} onCheckedChange={(v) => upd({ subPayClientGate: v })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="s-fee">قيمة رسوم البنك</Label>
                        <Input id="s-fee" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={String(form.bankFeeAmount ?? "")} onChange={(e) => upd({ bankFeeAmount: Number(e.target.value || 0) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>طريقة رسوم البنك</Label>
                        <Select value={form.bankFeeMethod || ""} onValueChange={(v) => upd({ bankFeeMethod: v })}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="اختر الطريقة" />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            {(methodsQuery.data?.methods ?? []).map((m) => (
                              <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="s-ob-bank">الرصيد الافتتاحي — البنك</Label>
                        <Input id="s-ob-bank" className="h-9" dir="ltr" type="number" step="0.001" value={String(form.openingBalanceBank ?? "")} onChange={(e) => upd({ openingBalanceBank: Number(e.target.value || 0) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="s-ob-cash">الرصيد الافتتاحي — الصندوق</Label>
                        <Input id="s-ob-cash" className="h-9" dir="ltr" type="number" step="0.001" value={String(form.openingBalanceCash ?? "")} onChange={(e) => upd({ openingBalanceCash: Number(e.target.value || 0) })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="s-ob-date">تاريخ الرصيد الافتتاحي</Label>
                        <Input id="s-ob-date" className="h-9" dir="ltr" type="date" value={(form.openingBalanceDate || "").slice(0, 10)} onChange={(e) => upd({ openingBalanceDate: e.target.value })} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <PaymentMethodsCard methodsQuery={methodsQuery} onAuthError={onAuthError} />

                <SaveRow
                  onReset={() => setForm(settingsQuery.data!.settings as SettingsFormDTO)}
                  onSave={() => saveMutation.mutate()}
                  pending={saveMutation.isPending}
                />
              </>
            )}
          </TabsContent>
        )}

        {/* ===== 2) الطباعة والعرض (الجميع) ===== */}
        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">خيارات الطباعة والعرض</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">إعدادات الطباعة هنا؛ تبويب المطور للترخيص والترحيل.</p>
              <UnavailableOption
                title="🖨 وضع الطباعة الاقتصادي"
                desc="طباعة أبيض وأسود لتوفير الحبر."
              />
              <UnavailableOption
                title="⚡ الوضع السريع"
                desc="يسرّع الأجهزة القديمة بإيقاف ظلال البطاقات. يُطبق بعد إعادة التشغيل."
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 3) الأمان والمستخدمون / كلمة المرور ===== */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
              <UserCog className="size-4 text-primary" />
              <CardTitle className="text-base">{manager ? "الأمان والمستخدمون" : "كلمة المرور"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed">
              {manager ? (
                <p className="text-muted-foreground">
                  إدارة المستخدمين وكلمات المرور والصلاحيات (screen_* · action_* · report_*) تتم من
                  الشاشة المستقلة «المستخدمون» — افتحها من القائمة الجانبية للنظام؛ لا يوجد تكرار لها هنا.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  تغيير كلمة مرور حسابك يتم بواسطة المدير من الشاشة المستقلة «المستخدمون» —
                  اطلب ذلك من مدير النظام.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== 4) أنواع العقود (مدير) — إدارة كاملة (المرحلة 7-ج) ===== */}
        {manager && (
          <TabsContent value="contract-types" className="space-y-4">
            <ContractTypesManager onAuthError={onAuthError} />
          </TabsContent>
        )}

        {/* ===== 5) حسابات المصروفات (مدير) ===== */}
        {manager && <TabsContent value="expense-accounts"><ExpenseAccountsTab onAuthError={onAuthError} /></TabsContent>}

        {/* ===== 6) مراحل المتابعة (مدير) ===== */}
        {manager && <TabsContent value="workflow"><WorkflowTab onAuthError={onAuthError} /></TabsContent>}

        {/* ===== 7) جدول الزيارات (مدير) ===== */}
        {manager && <TabsContent value="visits"><VisitsTab onAuthError={onAuthError} /></TabsContent>}

        {/* ===== 8) البيانات والنسخ الاحتياطي (مدير) ===== */}
        {manager && (
          <TabsContent value="backup" className="space-y-4">
            {settingsQuery.isLoading || !form ? (
              <SettingsSkeleton />
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">النسخ الاحتياطي التلقائي</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch checked={Boolean(form.autoBackupEnabled)} onCheckedChange={(v) => upd({ autoBackupEnabled: v })} />
                        <span className="text-sm font-medium">تفعيل النسخ التلقائي كل</span>
                      </div>
                      <Input
                        className="h-9 w-24"
                        dir="ltr"
                        type="number"
                        min="1"
                        max="168"
                        value={String(form.autoBackupInterval ?? 24)}
                        onChange={(e) => upd({ autoBackupInterval: Math.max(1, Math.trunc(Number(e.target.value || 24))) })}
                      />
                      <span className="text-sm">ساعة</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="s-expiry">تنبيهات انتهاء العقود قبل (أيام):</Label>
                        <Input
                          id="s-expiry"
                          className="h-9"
                          dir="ltr"
                          placeholder="90,60,30,7"
                          value={form.expiryAlerts ?? ""}
                          onChange={(e) => upd({ expiryAlerts: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">افصل بين الأيام بفاصلة</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="s-collection">تنبيه تحصيل متأخر بعد:</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="s-collection"
                            className="h-9 w-24"
                            dir="ltr"
                            type="number"
                            min="7"
                            max="365"
                            value={String(form.collectionAlertDays ?? 30)}
                            onChange={(e) => upd({ collectionAlertDays: Math.max(7, Math.trunc(Number(e.target.value || 30))) })}
                          />
                          <span className="text-sm">يوم</span>
                        </div>
                        <p className="text-xs text-muted-foreground">بلا سند قبض على عقد عليه متبقٍ</p>
                      </div>
                    </div>
                    <SaveRow
                      onReset={() => setForm(settingsQuery.data!.settings as SettingsFormDTO)}
                      onSave={() => saveMutation.mutate()}
                      pending={saveMutation.isPending}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
                    <DatabaseBackup className="size-4 text-primary" />
                    <CardTitle className="text-base">النسخ اليدوي والاستعادة</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-relaxed text-muted-foreground">
                    <p>
                      إنشاء النسخ الاحتياطية واستعادتها وفهرس النسخ يُدار من الشاشة المستقلة
                      «إدارة البيانات» — افتحها من القائمة الجانبية للنظام.
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        )}

        {/* ===== 9) أدوات المطور (developer فقط) ===== */}
        {isDeveloper && <TabsContent value="developer"><DeveloperTab onAuthError={onAuthError} /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ==================== صف الحفظ (كالمكتبي _save_row) ====================

function SaveRow({ onReset, onSave, pending }: { onReset: () => void; onSave: () => void; pending: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t pt-3">
      <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onReset} disabled={pending}>
        <RotateCcw className="size-4" />
        استعادة
      </Button>
      <Button size="sm" className="h-9 gap-1.5" onClick={onSave} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        حفظ الإعدادات
      </Button>
    </div>
  );
}

// ==================== خيار غير متاح (نمط شفاف واضح) ====================

function UnavailableOption({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed p-3 opacity-60">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">غير متاح في نسخة الويب الحالية</span>
    </div>
  );
}

// ==================== بطاقة عنوان غير متاح (أدوات المطور) ====================

function UnavailableCard({ title }: { title: string }) {
  return (
    <Card className="opacity-60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">غير متاح في نسخة الويب الحالية</p>
      </CardContent>
    </Card>
  );
}

// ==================== 5) حسابات المصروفات — CRUD ====================

interface ExpenseAccountFull {
  id: number;
  name: string;
  parentId?: number | null;
  fullPath?: string;
  isActive?: boolean;
  allowPosting?: boolean;
  includeInProfitability?: boolean;
  accountKind?: string;
  sortOrder?: number;
}

const EXP_ACCOUNT_KIND_LABEL: Record<string, string> = {
  expense: "مصروف",
  advance: "سلفة",
};

function ExpenseAccountsTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const accQuery = useQuery<ExpenseAccountFull[], Error>({
    queryKey: ["expense-accounts"],
    queryFn: async () => {
      const data = await apiGet<unknown>("/api/expense-accounts");
      if (Array.isArray(data)) return data as ExpenseAccountFull[];
      const wrapped = data as { accounts?: ExpenseAccountFull[] };
      return wrapped?.accounts ?? [];
    },
    retry: false,
  });
  const accounts: ExpenseAccountFull[] = accQuery.data ?? [];
  const parents = accounts.filter((a) => !a.parentId);
  const [parentId, setParentId] = React.useState<string>("");
  const selectedParent = parents.find((p) => String(p.id) === parentId) || parents[0] || null;
  const children = selectedParent ? accounts.filter((a) => a.parentId === selectedParent.id) : [];
  const [selectedChildId, setSelectedChildId] = React.useState<number | null>(null);
  const selectedChild = children.find((c) => c.id === selectedChildId) || null;

  // إعادة ضبط التحديد عند تغير القائمة
  React.useEffect(() => {
    if (selectedChildId && !selectedChild) setSelectedChildId(null);
  }, [selectedChildId, selectedChild]);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<"parent" | "child">("child");
  const [editForm, setEditForm] = React.useState<{
    id: number;
    name: string;
    isActive: boolean;
    allowPosting: boolean;
    includeInProfitability: boolean;
    accountKind: string;
  } | null>(null);

  const [addOpen, setAddOpen] = React.useState<"parent" | "child" | null>(null);
  const [addName, setAddName] = React.useState("");

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["expense-accounts"] });

  const addMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: addName.trim() };
      if (addOpen === "child" && selectedParent) body.parentId = selectedParent.id;
      return apiPost("/api/expense-accounts", body);
    },
    onSuccess: () => {
      toast({ title: "تمت الإضافة" });
      setAddOpen(null);
      setAddName("");
      refresh();
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  // PUT عبر /api/expense-accounts/[id] — العقد الفعلي للمسار (path param)
  const editMutation = useMutation({
    mutationFn: () => {
      if (!editForm) return Promise.resolve(null);
      return apiPut(`/api/expense-accounts/${editForm.id}`, {
        name: editForm.name.trim(),
        isActive: editForm.isActive,
        allowPosting: editForm.allowPosting,
        includeInProfitability: editForm.includeInProfitability,
        accountKind: editForm.accountKind,
      });
    },
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      setEditOpen(false);
      refresh();
    },
    onError: (e) => fail(e, "تعذر الحفظ"),
  });

  const toggleMutation = useMutation({
    mutationFn: (acc: ExpenseAccountFull) =>
      apiPut(`/api/expense-accounts/${acc.id}`, { isActive: !acc.isActive }),
    onSuccess: () => {
      toast({ title: "تم التبديل" });
      refresh();
    },
    onError: (e) => fail(e, "تعذر التبديل"),
  });

  const openEdit = (acc: ExpenseAccountFull) => {
    setEditForm({
      id: acc.id,
      name: acc.name,
      isActive: acc.isActive ?? true,
      allowPosting: acc.allowPosting ?? true,
      includeInProfitability: acc.includeInProfitability ?? true,
      accountKind: acc.accountKind || "expense",
    });
    setEditOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">شجرة حسابات المصروفات</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            اختر الحساب الأب من القائمة الجانبية؛ تظهر الحسابات الأبناء المقابلة له فقط. سند الصرف يستخدم الأبناء فقط.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-9 gap-1.5" onClick={() => { setAddOpen("parent"); setAddName(""); }}>
            <Plus className="size-4" />
            ＋ إضافة حساب أب
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedParent}
            onClick={() => { setAddOpen("child"); setAddName(""); }}
          >
            <Plus className="size-4" />
            ＋ إضافة حساب ابن
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedChild && !selectedParent}
            onClick={() => openEdit((selectedChild || selectedParent)!)}
          >
            <Pencil className="size-4" />
            ✎ تعديل المحدد
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={!selectedChild && !selectedParent}
            onClick={() => toggleMutation.mutate((selectedChild || selectedParent)!)}
          >
            تفعيل/إيقاف المحدد
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {accQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : accQuery.isError ? (
          <div className="py-8 text-center text-sm text-destructive">
            تعذر تحميل حسابات المصروفات — {errMessage(accQuery.error)}
            <div className="mt-2">
              <Button size="sm" variant="outline" className="h-8" onClick={() => accQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
            {/* الحسابات الأب */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">الحسابات الأب</Label>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-1.5">
                {parents.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setParentId(String(p.id)); setSelectedChildId(null); }}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-sm transition-colors ${
                      selectedParent?.id === p.id
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-foreground/80 hover:bg-accent"
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.isActive === false && <span className="shrink-0 text-xs text-muted-foreground">· موقوف</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* الأبناء */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">الأبناء التابعة للحساب المحدد</Label>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-36">الحساب الابن</TableHead>
                      <TableHead className="w-16 text-center">نشط</TableHead>
                      <TableHead className="w-20 text-center">في السند</TableHead>
                      <TableHead className="w-24 text-center">يدخل الربحية</TableHead>
                      <TableHead className="w-20 text-center">النوع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {children.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          لا حسابات أبناء لهذا الحساب
                        </TableCell>
                      </TableRow>
                    ) : (
                      children.map((c) => (
                        <TableRow
                          key={c.id}
                          className={`cursor-pointer ${selectedChildId === c.id ? "bg-primary/5" : ""}`}
                          onClick={() => setSelectedChildId(c.id)}
                        >
                          <TableCell className="whitespace-nowrap">{c.name}</TableCell>
                          <TableCell className="text-center">{c.isActive === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center">{c.allowPosting === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center">{c.includeInProfitability === false ? "لا" : "نعم"}</TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {EXP_ACCOUNT_KIND_LABEL[c.accountKind || "expense"] || c.accountKind || "expense"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* إضافة حساب */}
      <Dialog open={addOpen !== null} onOpenChange={(v) => !v && setAddOpen(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">{addOpen === "parent" ? "إضافة حساب أب" : `إضافة حساب ابن — ${selectedParent?.name || ""}`}</DialogTitle>
            <DialogDescription>الاسم يظهر في قائمة حسابات سند الصرف.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ea-name">الاسم:*</Label>
            <Input id="ea-name" className="h-9" value={addName} onChange={(e) => setAddName(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(null)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addName.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل حساب */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل الحساب</DialogTitle>
            <DialogDescription>التعديل ينعكس على قوائم سند الصرف والربحية.</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ea-edit-name">الاسم:*</Label>
                <Input id="ea-edit-name" className="h-9" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">نشط</span>
                  <Switch checked={editForm.isActive} onCheckedChange={(v) => setEditForm({ ...editForm, isActive: v })} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">في السند</span>
                  <Switch checked={editForm.allowPosting} onCheckedChange={(v) => setEditForm({ ...editForm, allowPosting: v })} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <span className="text-sm">يدخل الربحية</span>
                  <Switch checked={editForm.includeInProfitability} onCheckedChange={(v) => setEditForm({ ...editForm, includeInProfitability: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label>النوع</Label>
                  <Select value={editForm.accountKind} onValueChange={(v) => setEditForm({ ...editForm, accountKind: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">مصروف</SelectItem>
                      <SelectItem value="advance">سلفة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditOpen(false)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm?.name.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ==================== 6) مراحل المتابعة — إدارة أساسية ====================

interface WorkflowStageDTO {
  id: number;
  transactionType: string;
  stageName: string;
  stageOrder: number;
  color: string;
  parentId?: number | null;
  expectedDays: number;
  contractType: string;
}

/** تسميات أنواع المعاملة — حرفيًا من workflow_service.TX_TYPES */
const TX_LABELS: Record<string, string> = {
  contract: "عقد",
  payment: "سند صرف",
  subcontract: "عقد باطن",
  customer: "عميل (ما قبل التعاقد)",
};

function WorkflowTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const stagesQuery = useQuery<{ stages: WorkflowStageDTO[] }>({
    queryKey: ["workflow-stages"],
    queryFn: () => apiGet<{ stages: WorkflowStageDTO[] }>("/api/workflow-stages"),
  });
  const stages: WorkflowStageDTO[] = stagesQuery.data?.stages ?? [];

  const [txType, setTxType] = React.useState("contract");
  const filtered = stages
    .filter((s) => s.transactionType === txType)
    .sort((a, b) => a.stageOrder - b.stageOrder || a.id - b.id);

  const [addName, setAddName] = React.useState("");
  const [addDays, setAddDays] = React.useState("0");
  const [editStage, setEditStage] = React.useState<WorkflowStageDTO | null>(null);
  const [editForm, setEditForm] = React.useState<{ stageName: string; stageOrder: number; expectedDays: number; color: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<WorkflowStageDTO | null>(null);

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["workflow-stages"] });

  const addMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/workflow-stages", {
        transactionType: txType,
        stageName: addName.trim(),
        stageOrder: filtered.length > 0 ? Math.max(...filtered.map((s) => s.stageOrder)) + 1 : 1,
        expectedDays: Math.max(0, Math.trunc(Number(addDays || 0))),
      }),
    onSuccess: () => {
      toast({ title: "أُضيفت المرحلة" });
      setAddName("");
      setAddDays("0");
      refresh();
    },
    onError: (e) => fail(e, "تعذر إضافة المرحلة"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/workflow-stages?id=${editStage!.id}`, {
        stageName: editForm!.stageName.trim(),
        stageOrder: Math.trunc(editForm!.stageOrder),
        expectedDays: Math.max(0, Math.trunc(editForm!.expectedDays)),
        color: editForm!.color,
      }),
    onSuccess: () => {
      toast({ title: "تم تعديل المرحلة" });
      setEditStage(null);
      refresh();
    },
    onError: (e) => fail(e, "تعذر تعديل المرحلة"),
  });

  // تحريك لأعلى/لأسفل — تبديل الترتيب مع الجار في نفس (النوع + القالب)
  const moveMutation = useMutation({
    mutationFn: async ({ stage, dir }: { stage: WorkflowStageDTO; dir: -1 | 1 }) => {
      const group = filtered.filter((s) => s.contractType === stage.contractType);
      const idx = group.findIndex((s) => s.id === stage.id);
      const swapWith = group[idx + dir];
      if (!swapWith) return null;
      await apiPatch(`/api/workflow-stages?id=${stage.id}`, { stageOrder: swapWith.stageOrder });
      await apiPatch(`/api/workflow-stages?id=${swapWith.id}`, { stageOrder: stage.stageOrder });
      return true;
    },
    onSuccess: () => refresh(),
    onError: (e) => fail(e, "تعذر تغيير الترتيب"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/workflow-stages?id=${id}`),
    onSuccess: () => {
      toast({ title: "تم حذف المرحلة" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر حذف المرحلة");
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">مراحل المتابعة والتنفيذ</CardTitle>
        <p className="text-xs text-muted-foreground">كل نوع عقد له شجرة مستقلة تُنسخ للعقود الجديدة.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52 space-y-1">
            <Label className="text-xs text-muted-foreground">نوع المعاملة:</Label>
            <Select value={txType} onValueChange={setTxType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TX_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">مرحلة جديدة:</Label>
            <Input
              className="h-9"
              placeholder="اسم المرحلة الجديدة..."
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>
          <div className="w-32 space-y-1">
            <Label className="text-xs text-muted-foreground">الأيام المتوقعة:</Label>
            <Input className="h-9" dir="ltr" type="number" min="0" max="999" value={addDays} onChange={(e) => setAddDays(e.target.value)} />
          </div>
          <Button size="sm" className="h-9 gap-1.5" disabled={addMutation.isPending || !addName.trim()} onClick={() => addMutation.mutate()}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </div>

        {stagesQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg" />
            ))}
          </div>
        ) : stagesQuery.isError ? (
          <p className="py-6 text-center text-sm text-destructive">تعذر تحميل المراحل — {errMessage(stagesQuery.error)}</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا مراحل لهذا النوع بعد — أضف أول مرحلة من الأعلى.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="min-w-40">المرحلة</TableHead>
                  <TableHead className="w-28">قالب النوع</TableHead>
                  <TableHead className="w-24 text-center">الأيام المتوقعة</TableHead>
                  <TableHead className="w-16 text-center">اللون</TableHead>
                  <TableHead className="w-36 text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{s.stageName}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{s.contractType || "القالب العام"}</TableCell>
                    <TableCell className="text-center tabular-nums">{s.expectedDays}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-block size-4 rounded-full border" style={{ backgroundColor: s.color || "#3B82F6" }} aria-label={s.color} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" aria-label="تحريك لأعلى" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ stage: s, dir: -1 })}>
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" aria-label="تحريك لأسفل" disabled={moveMutation.isPending} onClick={() => moveMutation.mutate({ stage: s, dir: 1 })}>
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="تعديل المرحلة"
                          onClick={() => {
                            setEditStage(s);
                            setEditForm({ stageName: s.stageName, stageOrder: s.stageOrder, expectedDays: s.expectedDays, color: s.color || "#3B82F6" });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" aria-label="حذف المرحلة" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* تعديل مرحلة */}
      <Dialog open={editStage !== null} onOpenChange={(v) => !v && setEditStage(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل المرحلة</DialogTitle>
            <DialogDescription>{TX_LABELS[editStage?.transactionType || ""] || ""}</DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wf-name">اسم المرحلة:*</Label>
                <Input id="wf-name" className="h-9" value={editForm.stageName} onChange={(e) => setEditForm({ ...editForm, stageName: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-order">الترتيب:</Label>
                  <Input id="wf-order" className="h-9" dir="ltr" type="number" value={String(editForm.stageOrder)} onChange={(e) => setEditForm({ ...editForm, stageOrder: Number(e.target.value || 0) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-days">الأيام المتوقعة:</Label>
                  <Input id="wf-days" className="h-9" dir="ltr" type="number" min="0" max="999" value={String(editForm.expectedDays)} onChange={(e) => setEditForm({ ...editForm, expectedDays: Number(e.target.value || 0) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-color">اللون:</Label>
                  <Input id="wf-color" className="h-9 w-full p-1" dir="ltr" type="color" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditStage(null)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm?.stageName.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد حذف مرحلة */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المرحلة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.stageName}». لا يمكن حذف مرحلة لها مراحل فرعية أو مرتبطة بقالب دفعات أو نطاق عقود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ==================== 7) جدول الزيارات ====================

interface VisitConfigDTO {
  startHour: number;
  endHour: number;
  slotMinutes: number;
  editable: boolean;
  note?: string;
}

interface VisitStaffDTO {
  id: number;
  name: string;
  phone: string;
  active: boolean;
  sort: number;
  todayVisits: number;
}

function VisitsTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const configQuery = useQuery<VisitConfigDTO>({
    queryKey: ["visits-config"],
    queryFn: () => apiGet<VisitConfigDTO>("/api/visits/config"),
  });

  const staffQuery = useQuery<{ staff: VisitStaffDTO[] }>({
    queryKey: ["visits-staff"],
    queryFn: () => apiGet<{ staff: VisitStaffDTO[] }>("/api/visits/staff"),
  });
  const staff: VisitStaffDTO[] = staffQuery.data?.staff ?? [];

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["visits-staff"] });

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState({ name: "", phone: "" });
  const [editStaff, setEditStaff] = React.useState<VisitStaffDTO | null>(null);
  const [editForm, setEditForm] = React.useState({ name: "", phone: "", active: true });
  const [deleteTarget, setDeleteTarget] = React.useState<VisitStaffDTO | null>(null);

  const addMutation = useMutation({
    mutationFn: () => apiPost("/api/visits/staff", { name: addForm.name.trim(), phone: addForm.phone.trim() }),
    onSuccess: () => {
      toast({ title: "أُضيف الموظف" });
      setAddOpen(false);
      setAddForm({ name: "", phone: "" });
      refresh();
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      apiPatch(`/api/visits/staff/${editStaff!.id}`, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        active: editForm.active,
      }),
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      setEditStaff(null);
      refresh();
    },
    onError: (e) => fail(e, "تعذر الحفظ"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/visits/staff/${id}`),
    onSuccess: () => {
      toast({ title: "تم الحذف" });
      setDeleteTarget(null);
      refresh();
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر الحذف");
    },
  });

  return (
    <div className="space-y-4">
      {/* ساعات العمل */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ساعات عمل جدول الزيارات</CardTitle>
          <p className="text-xs text-muted-foreground">
            صفوف الجدول تُبنى من هذه الساعات — ومدة الحصة تحدد دقة المواعيد (30 دقيقة = نصف ساعة لكل خانة).
          </p>
        </CardHeader>
        <CardContent>
          {configQuery.isLoading ? (
            <Skeleton className="h-10 w-72 rounded-lg" />
          ) : configQuery.isError ? (
            <p className="text-sm text-destructive">تعذر تحميل الإعدادات — {errMessage(configQuery.error)}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>من الساعة: <b className="tabular-nums">{configQuery.data?.startHour}</b></span>
              <span className="text-muted-foreground">·</span>
              <span>إلى الساعة: <b className="tabular-nums">{configQuery.data?.endHour}</b></span>
              <span className="text-muted-foreground">·</span>
              <span>مدة الحصة: <b className="tabular-nums">{configQuery.data?.slotMinutes}</b> دقيقة</span>
              {configQuery.data?.note && (
                <p className="mt-1 w-full text-xs text-muted-foreground">{configQuery.data.note}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* الموظفون */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">الموظفون (أعمدة الجدول)</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">أضف موظفي الزيارات وأرقام واتسابهم.</p>
          </div>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            إضافة
          </Button>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {staffQuery.isLoading ? (
            <div className="space-y-2 px-6 pb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 rounded-lg" />
              ))}
            </div>
          ) : staff.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">لا موظفين — أضف أول موظف.</p>
          ) : (
            <div className="overflow-x-auto px-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-36">الموظف</TableHead>
                    <TableHead className="w-32">الهاتف</TableHead>
                    <TableHead className="w-24 text-center">زيارات مسجلة</TableHead>
                    <TableHead className="w-16 text-center">تفعيل</TableHead>
                    <TableHead className="w-16 text-center">حذف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-start hover:underline"
                          onClick={() => {
                            setEditStaff(s);
                            setEditForm({ name: s.name, phone: s.phone, active: s.active });
                          }}
                        >
                          {s.name}
                          {s.active === false && <span className="ms-1 text-xs text-muted-foreground">· موقوف</span>}
                        </button>
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">{s.phone || "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{s.todayVisits}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={s.active}
                          onCheckedChange={(v) =>
                            apiPatch(`/api/visits/staff/${s.id}`, { active: v })
                              .then(() => refresh())
                              .catch((e) => fail(e, "تعذر التبديل"))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label="حذف"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* إضافة موظف */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">إضافة موظف زيارات</DialogTitle>
            <DialogDescription>يظهر الموظف كعمود في جدول الزيارات.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vs-name">الاسم:*</Label>
              <Input id="vs-name" className="h-9" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vs-phone">الهاتف (واتساب):</Label>
              <Input id="vs-phone" className="h-9" dir="ltr" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addForm.name.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تعديل موظف */}
      <Dialog open={editStaff !== null} onOpenChange={(v) => !v && setEditStaff(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base">✎ تعديل الموظف</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vs-edit-name">الاسم:*</Label>
              <Input id="vs-edit-name" className="h-9" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vs-edit-phone">الهاتف (واتساب):</Label>
              <Input id="vs-edit-phone" className="h-9" dir="ltr" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">مفعّل</span>
              <Switch checked={editForm.active} onCheckedChange={(v) => setEditForm({ ...editForm, active: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setEditStaff(null)} disabled={editMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={editMutation.isPending || !editForm.name.trim()} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف موظف الزيارات؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.name}». الموظف له زيارات مسجلة لا يُحذف — يُعطَّل بدلًا من ذلك.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ==================== 9) أدوات المطور ====================

interface FeatureFlagDTO {
  key: string;
  name: string;
  desc: string;
  group: string;
  requires: string[];
  enabled: boolean;
  effective: boolean;
}

function DeveloperTab({ onAuthError }: { onAuthError: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const flagsQuery = useQuery<{ flags: FeatureFlagDTO[] }>({
    queryKey: ["feature-flags"],
    queryFn: () => apiGet<{ flags: FeatureFlagDTO[] }>("/api/feature-flags"),
    retry: false,
  });
  const flags: FeatureFlagDTO[] = flagsQuery.data?.flags ?? [];
  const nameByKey = React.useMemo(() => new Map(flags.map((f) => [f.key, f.name])), [flags]);

  // تجميع حسب المجموعة مع حفظ ترتيبها
  const groups = React.useMemo(() => {
    const map = new Map<string, FeatureFlagDTO[]>();
    for (const f of flags) {
      const g = map.get(f.group) || [];
      g.push(f);
      map.set(f.group, g);
    }
    return [...map.entries()];
  }, [flags]);

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiPut("/api/feature-flags", { key, enabled }),
    onSuccess: () => {
      toast({ title: "تم الحفظ" });
      qc.invalidateQueries({ queryKey: ["feature-flags"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) onAuthError();
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errMessage(e) });
    },
  });

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-status-warn/40 bg-status-warn-bg px-3 py-2 text-sm font-bold text-status-warn">
        ⚠ أدوات المطور فقط.
      </p>

      {/* المزايا */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مزايا النظام (ما يظهر لهذا العميل)</CardTitle>
          <p className="text-xs text-muted-foreground">اختر المزايا الظاهرة للعميل. البيانات لا تُحذف.</p>
        </CardHeader>
        <CardContent>
          {flagsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : flagsQuery.isError ? (
            <div className="py-6 text-center text-sm text-destructive">
              تعذر تحميل المزايا — {errMessage(flagsQuery.error)}
              <div className="mt-2">
                <Button size="sm" variant="outline" className="h-8" onClick={() => flagsQuery.refetch()}>إعادة المحاولة</Button>
              </div>
            </div>
          ) : flags.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا مزايا معرفة.</p>
          ) : (
            <TooltipProvider delayDuration={200}>
              <div className="max-h-[28rem] space-y-4 overflow-y-auto rounded-md border p-3">
                {groups.map(([group, items]) => (
                  <div key={group} className="space-y-1.5">
                    <h3 className="text-sm font-extrabold">{group}</h3>
                    {items.map((f) => {
                      const gated = f.enabled && !f.effective;
                      const requiresNames = (f.requires || [])
                        .map((k) => nameByKey.get(k) || k)
                        .join(" · ");
                      return (
                        <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{f.name}</div>
                            {f.desc && <div className="text-xs text-muted-foreground">{f.desc}</div>}
                            {gated && requiresNames && (
                              <div className="mt-0.5 text-xs font-bold text-status-warn">
                                يعتمد على: {requiresNames} (معطل)
                              </div>
                            )}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex shrink-0 pt-0.5">
                                <Switch
                                  checked={f.enabled}
                                  disabled={gated}
                                  onCheckedChange={(v) => toggleMutation.mutate({ key: f.key, enabled: v })}
                                  aria-label={`تبديل ${f.name}`}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {gated
                                ? `معطّل لاعتماده على مفتاح أب معطل${requiresNames ? `: ${requiresNames}` : ""}`
                                : requiresNames
                                  ? `يحتاج: ${requiresNames}`
                                  : f.key}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* بقية أدوات المطور — خارج النطاق المعتمد */}
      <UnavailableCard title="الهوية والترخيص" />
      <UnavailableCard title="الترحيل والاستيراد" />
      <UnavailableCard title="الشبكة والنسخ" />
      <UnavailableCard title="تنظيف البيانات" />
    </div>
  );
}

// ==================== أساليب الدفع (منتبقية كما هي) ====================

function PaymentMethodsCard({
  methodsQuery,
  onAuthError,
}: {
  methodsQuery: { data?: PaymentMethodsResponse; isLoading: boolean; refetch: () => void };
  onAuthError: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const items = methodsQuery.data?.methods ?? [];

  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState<{ name: string; feeType: string; feeValue: string; isActive: boolean }>({
    name: "",
    feeType: "amount",
    feeValue: "0",
    isActive: true,
  });
  const [deleteTarget, setDeleteTarget] = React.useState<PaymentMethodDTO | null>(null);

  const fail = (e: unknown, title: string) => {
    if (e instanceof ApiError && e.status === 401) onAuthError();
    toast({ variant: "destructive", title, description: errMessage(e) });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      apiPost<{ method: PaymentMethodDTO }>("/api/payment-methods", {
        name: addForm.name.trim(),
        feeType: addForm.feeType,
        feeValue: Number(addForm.feeValue || 0),
        isActive: addForm.isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "تمت الإضافة", description: "أُضيف أسلوب الدفع" });
      setAddOpen(false);
      setAddForm({ name: "", feeType: "amount", feeValue: "0", isActive: true });
    },
    onError: (e) => fail(e, "تعذر الإضافة"),
  });

  // عقد الخلفي: PATCH/DELETE عبر ?id= — التعديل الفوري عند مغادرة الحقل
  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<PaymentMethodDTO> }) =>
      apiPatch<{ method: PaymentMethodDTO }>(`/api/payment-methods?id=${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      toast({ title: "تم", description: "حُدّث أسلوب الدفع" });
    },
    onError: (e) => fail(e, "تعذر التعديل"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/payment-methods?id=${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-methods"] });
      toast({ title: "تم الحذف", description: "حُذف أسلوب الدفع" });
      setDeleteTarget(null);
    },
    onError: (e) => {
      setDeleteTarget(null);
      fail(e, "تعذر الحذف");
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">أساليب الدفع والرسوم</CardTitle>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" />
          إضافة
        </Button>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {methodsQuery.isLoading ? (
          <div className="space-y-2 px-6 pb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">لا أساليب دفع — أضف أول أسلوب.</p>
        ) : (
          <div className="overflow-x-auto px-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-36">الاسم</TableHead>
                  <TableHead className="w-32">نوع الرسم</TableHead>
                  <TableHead className="w-28">القيمة</TableHead>
                  <TableHead className="w-20 text-center">تفعيل</TableHead>
                  <TableHead className="w-16 text-center">حذف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Input
                        className="h-9"
                        defaultValue={m.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== m.name) patchMutation.mutate({ id: m.id, body: { name: v } });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.feeType}
                        onValueChange={(v) => patchMutation.mutate({ id: m.id, body: { feeType: v } })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="amount">مبلغ ثابت</SelectItem>
                          <SelectItem value="percent">نسبة %</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-9"
                        dir="ltr"
                        type="number"
                        min="0"
                        step="0.001"
                        defaultValue={String(Number(m.feeValue))}
                        onBlur={(e) => {
                          const v = Number(e.target.value || 0);
                          if (v !== Number(m.feeValue)) patchMutation.mutate({ id: m.id, body: { feeValue: v } });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={m.isActive} onCheckedChange={(v) => patchMutation.mutate({ id: m.id, body: { isActive: v } })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(m)}
                        aria-label="حذف"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* إضافة أسلوب */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">إضافة أسلوب دفع</DialogTitle>
            <DialogDescription>سيظهر الاسم في قوائم طرق الدفع عند السندات.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-name">الاسم *</Label>
              <Input id="pm-name" className="h-9" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نوع الرسم</Label>
                <Select value={addForm.feeType} onValueChange={(v) => setAddForm((f) => ({ ...f, feeType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amount">مبلغ ثابت</SelectItem>
                    <SelectItem value="percent">نسبة %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-value">القيمة</Label>
                <Input id="pm-value" className="h-9" dir="ltr" type="number" min="0" step="0.001" value={addForm.feeValue} onChange={(e) => setAddForm((f) => ({ ...f, feeValue: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">مفعّل</span>
              <Switch checked={addForm.isActive} onCheckedChange={(v) => setAddForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>إلغاء</Button>
            <Button className="h-9" disabled={addMutation.isPending || !addForm.name.trim()} onClick={() => addMutation.mutate()}>
              {addMutation.isPending ? "جارٍ الإضافة…" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأكيد الحذف */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف أسلوب الدفع؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف «{deleteTarget?.name}». إن كان مستخدمًا في سندات سيرفض النظام الحذف مع إظهار السبب.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "جارٍ الحذف…" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
    </div>
  );
}
