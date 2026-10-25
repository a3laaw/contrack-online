"use client";

/**
 * شاشة الإعدادات — نقطة الدخول (المرحلة 9 · بند 6).
 * أُعيدت هيكلتها إلى تبويبات مطابقة للمكتبي حرفيًا (settings.py:461-533):
 *   ⌂ بيانات الشركة · ▤ الطباعة والعرض · ◆ الأمان والمستخدمون/كلمة المرور ·
 *   ☰ أنواع العقود · § حسابات المصروفات · ⇄ مراحل المتابعة · ◷ جدول الزيارات ·
 *   ⊞ البيانات والنسخ الاحتياطي · ⚙ أدوات المطور (developer فقط — بتابات
 *   داخلية خمسة). المحتوى موزع في src/components/contrack/settings/*.
 *
 * كل الأسلاك القائمة محفوظة: /api/settings (بيانات الشركة والنسخ التلقائي)،
 * /api/payment-methods، تبويب المزايا الحي عبر /api/feature-flags، وحروف
 * الشل (initialSection) تقود التبويب النشط كما في السابق — مع ظهور شريط
 * التبويبات نفسه للتنقل المباشر بينها.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiGet, apiPut } from "./api";
import type { PaymentMethodsResponse, SettingsResponse, User } from "./contrack-types";
import { errMessage } from "./contrack-types";
import { ContractTypesManager } from "./ContractTypesManager";
import { CompanyTab } from "./settings/company-tab";
import { CompaniesTab } from "./settings/companies-tab";
import { AppearanceTab } from "./settings/appearance-tab";
import { SecurityTab } from "./settings/security-tab";
import { ExpenseAccountsTab } from "./settings/expense-accounts-tab";
import { WorkflowTab } from "./settings/workflow-tab";
import { VisitsTab } from "./settings/visits-tab";
import { BackupTab } from "./settings/backup-tab";
import { DeveloperTab } from "./settings/developer-tab";
import { type SettingsFormDTO } from "./settings/shared";
import { resolveInitialSection, visibleSettingsTabs } from "./settings/tabs-catalog";

interface SettingsViewProps {
  user: User;
  onAuthError: () => void;
  /** القسم المبدئي من القائمة الجانبية (قيمة تبويب: company/appearance/security/…) */
  initialSection?: string;
}

export function SettingsView({ user, onAuthError, initialSection }: SettingsViewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // is_admin() المكتبية تشمل المدير والمطور — وis_developer للمطور وحده
  const manager = user.role === "admin" || user.role === "developer";
  const isDeveloper = user.role === "developer";

  // القسم النشط — يقوده اختيار القائمة الجانبية، وشريط التبويبات يسمح
  // بالتنقل المباشر بين التبويبات المرئية للدور (كترتيب المكتبي نفسه)
  const [tab, setTab] = React.useState(() => resolveInitialSection(initialSection, manager, isDeveloper));
  React.useEffect(() => {
    setTab(resolveInitialSection(initialSection, manager, isDeveloper));
  }, [initialSection, manager, isDeveloper]);

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

  const tabs = visibleSettingsTabs(manager, isDeveloper);
  const formReady = manager && !settingsQuery.isLoading && !!form;
  const formError = manager && settingsQuery.isError;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold whitespace-nowrap">الإعدادات</h1>
        <span className="hidden xl:inline text-xs text-muted-foreground">بيانات الشركة والطباعة والمستخدمون والأنواع والمراحل والنسخ — تُحفظ كل مجموعة من زرها</span>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        {/* شريط التبويبات الحرفي بترتيب المكتبي — والأقسام تقودها القائمة الجانبية أيضًا */}
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-auto" aria-label="تبويبات الإعدادات">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="whitespace-nowrap">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ===== 0) الشركات — SaaS (Task 97: للمطور فقط — مدير الشركة يبقى داخل شركته) ===== */}
        {isDeveloper && (
          <TabsContent value="companies" className="space-y-4">
            <CompaniesTab />
          </TabsContent>
        )}

        {/* ===== 1) بيانات الشركة (مدير/مطور — is_admin) ===== */}
        {manager && (
          <TabsContent value="company" className="space-y-4">
            {!formReady ? (
              formError ? (
                <Card className="border-status-danger/40">
                  <CardContent className="p-6 text-center text-sm text-muted-foreground">{errMessage(settingsQuery.error)}</CardContent>
                </Card>
              ) : (
                <SettingsSkeleton />
              )
            ) : (
              <CompanyTab
                form={form!}
                upd={upd}
                methodsQuery={methodsQuery}
                onReset={() => setForm(settingsQuery.data!.settings as SettingsFormDTO)}
                onSave={() => saveMutation.mutate()}
                savePending={saveMutation.isPending}
                onAuthError={onAuthError}
              />
            )}
          </TabsContent>
        )}

        {/* ===== 2) الطباعة والعرض (الجميع) ===== */}
        <TabsContent value="appearance" className="space-y-4">
          <AppearanceTab />
        </TabsContent>

        {/* ===== 3) الأمان والمستخدمون / كلمة المرور ===== */}
        <TabsContent value="security" className="space-y-4">
          <SecurityTab manager={manager} username={user.username} />
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
            {!formReady ? (
              <SettingsSkeleton />
            ) : (
              <BackupTab
                form={form!}
                upd={upd}
                onReset={() => setForm(settingsQuery.data!.settings as SettingsFormDTO)}
                onSave={() => saveMutation.mutate()}
                savePending={saveMutation.isPending}
              />
            )}
          </TabsContent>
        )}

        {/* ===== 9) أدوات المطور (developer فقط — بتابات داخلية خمسة) ===== */}
        {isDeveloper && <TabsContent value="developer"><DeveloperTab onAuthError={onAuthError} /></TabsContent>}
      </Tabs>
    </div>
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
