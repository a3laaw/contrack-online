"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { apiGet, apiPost, setStoredToken, clearStoredToken, ApiError } from "./api";
import type { StatementTarget, User, ViewName } from "./contrack-types";
import { isManagerRole } from "./contrack-types";
import type { NavChild } from "./nav-structure";
import { NAV_MODULES } from "./nav-structure";
import { NAVIGATE_DENIED_MSG, canOpenView, isChildVisible, permAllows, type PermsMap } from "./nav-perms";
import { useToast } from "@/hooks/use-toast";
import { DueItemsView } from "./DueItemsView";
import { FeatureFlagsProvider } from "./FeatureFlagsProvider";
import { AppShell } from "./AppShell";
import { LoginView } from "./LoginView";
import { DashboardView, type DashboardQuickAction } from "./DashboardView";
import { CustomersView } from "./CustomersView";
import { CustomerFilePage } from "./CustomerFilePage";
import { ContractsView } from "./ContractsView";
import { ContractGroupsView } from "./ContractGroupsView";
import { FormsCenterView } from "./FormsCenterView";
import { ContractDetailView } from "./ContractDetailView";
import { VouchersView } from "./VouchersView";
import { CustodyView } from "./CustodyView";
import { AdvancesView } from "./AdvancesView";
import { InvoicesView } from "./InvoicesView";
import { GatewayView } from "./GatewayView";
import { OtherCompanyView } from "./OtherCompanyView";
import { SubcontractorsView } from "./SubcontractorsView";
import { ReportsView } from "./ReportsView";
import { DEFAULT_REPORT_KEY } from "./reports-list";
import { StatementView } from "./StatementView";
import { FollowupView } from "./FollowupView";
import { ClaimsView } from "./ClaimsView";
import { TasksView } from "./TasksView";
import { VisitsView } from "./VisitsView";
import { CommentsView } from "./CommentsView";
import { SearchDialog } from "./SearchDialog";
import { SettingsView } from "./SettingsView";
import { UsersView } from "./UsersView";
import { DataManagementView } from "./DataManagementView";

/** جذر التطبيق: مزوّد React-Query فقط — الـQueryClient يُنشأ مرة واحدة */
export default function ConTrackApp() {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <FeatureFlagsProvider>
        <AppRoot />
      </FeatureFlagsProvider>
    </QueryClientProvider>
  );
}

type AuthData = { user: User | null; perms: PermsMap };

function AppRoot() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const authQuery = useQuery<AuthData>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        // /api/auth/me يعيد أصلًا { user, perms } — بند 5: نستغل الاستجابة نفسها بلا نداء إضافي
        const res = await apiGet<{ user: User; perms: Record<string, boolean> }>("/api/auth/me");
        return { user: res.user, perms: res.perms ?? null };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return { user: null, perms: null };
        throw e;
      }
    },
  });

  const [view, setView] = React.useState<ViewName>("dashboard");
  const [contractId, setContractId] = React.useState<number | null>(null);
  const [customerFileId, setCustomerFileId] = React.useState<number | null>(null);
  const [newContractCustomerId, setNewContractCustomerId] = React.useState<number | null>(null);

  // ===== حالات الشاشات الجديدة (المهمة 10-b) =====
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [statementTarget, setStatementTarget] = React.useState<StatementTarget | null>(null);
  const [vouchersPresetQ, setVouchersPresetQ] = React.useState<string | null>(null);

  // ===== وضع السندات وأقسام الإعدادات وإدارة البيانات والتقارير (هيكل التنقل المعتمد) =====
  const [vouchersMode, setVouchersMode] = React.useState<"receipt" | "payment">("receipt");
  const [settingsSection, setSettingsSection] = React.useState<string>("company");
  const [dmSection, setDmSection] = React.useState<string>("backup");
  const [reportsKey, setReportsKey] = React.useState<string>(DEFAULT_REPORT_KEY);

  // معرّف البند النشط في القائمة الجانبية (يحدد الوحدة والبند المُبرز)
  const activeNav =
    view === "vouchers"
      ? vouchersMode === "payment"
        ? "vouchers-payment"
        : "vouchers-receipt"
      : view === "reports"
        ? `report-${reportsKey}`
        : view === "settings"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "settings" && c.section === settingsSection)?.id ??
          "settings-printing")
        : view === "data-mgmt"
          ? dmSection === "devtools"
            ? "devtools"
            : "backup"
          : view;

  const user = authQuery.data?.user ?? null;
  const perms = authQuery.data?.perms ?? null;
  const manager = isManagerRole(user?.role);
  // بند 5: مرآة has_permission المكتبي — الدور أولًا (المدير/المطور الكل دائمًا) ثم
  // الخريطة (الممنوع=false فقط يُرفض) والمفتاح المجهول/غير المحمّل لا يقيّد
  const permOn = React.useCallback((k: string) => permAllows(perms, k, manager), [perms, manager]);

  // اختيار بند من القائمة الجانبية — حرس التنقل الحرفي أولًا (مرآة _navigate: main_window.py:1984-1988):
  // بند شل بلا صلاحية لا يُفتح ويظهر توست المكتبي الحرفي — والميزات لا تمنع الفتح (تخفي الزر فقط)
  const selectChild = React.useCallback(
    (child: NavChild) => {
      if (!isChildVisible(child, { isAdmin: manager, flagOn: () => true, permOn })) {
        toast({ title: NAVIGATE_DENIED_MSG });
        return;
      }
      if (child.view === "vouchers" && child.mode) setVouchersMode(child.mode);
      if (child.view === "settings" && child.section) setSettingsSection(child.section);
      if (child.view === "data-mgmt" && child.section) setDmSection(child.section);
      if (child.view === "reports" && child.report) setReportsKey(child.report);
      setView(child.view);
      if (child.view !== "contract") setContractId(null);
      if (child.view !== "customer-file") setCustomerFileId(null);
    },
    [manager, permOn, toast]
  );

  // أي 401 في أي شاشة ⇒ إعادة فحص الجلسة ⇒ عرض شاشة الدخول
  const onAuthError = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["auth"] });
  }, [qc]);

  const handleLoggedIn = React.useCallback(
    (u: User, token: string, userPerms?: Record<string, boolean>) => {
      setStoredToken(token);
      // الدخول يعيد الصلاحيات معه (بند 5) — فتُعرض الشل مفلترة من أول لحظة بلا وميض
      qc.setQueryData<AuthData>(["auth", "me"], { user: u, perms: userPerms ?? null });
      setView("dashboard");
      setContractId(null);
    },
    [qc]
  );

  const handleLogout = React.useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* الجلسة قد تكون منتهية أصلًا */
    }
    clearStoredToken();
    qc.clear();
    qc.setQueryData<AuthData>(["auth", "me"], { user: null, perms: null });
    setView("dashboard");
    setContractId(null);
    setCustomerFileId(null);
    setNewContractCustomerId(null);
    setReportsKey(DEFAULT_REPORT_KEY);
  }, [qc]);

  // حرس فتح الـviews مباشرة (مسارات جانبية: بحث/رجوع/فتح كشف من عقد) — كحرس _navigate المكتبي
  const navigate = React.useCallback(
    (v: ViewName) => {
      if (!canOpenView(v, { isAdmin: manager, permOn })) {
        toast({ title: NAVIGATE_DENIED_MSG });
        return;
      }
      setView(v);
      if (v !== "contract") setContractId(null);
      if (v !== "customer-file") setCustomerFileId(null);
    },
    [manager, permOn, toast]
  );

  const openContract = React.useCallback(
    (id: number) => {
      setContractId(id);
      navigate("contract");
    },
    [navigate]
  );

  // فتح ملف العميل كصفحة داخلية (كالمكتبي dealings._open_customer — استبدال المحتوى لا تكدس نوافذ)
  const openCustomerFile = React.useCallback(
    (id: number) => {
      setCustomerFileId(id);
      navigate("customer-file");
    },
    [navigate]
  );

  // إجراءات الرئيسية السريعة — تفتح الشاشة المقابلة بوضعها (المحروس بنفس حرس navigate)
  const handleDashboardQuickAction = React.useCallback(
    (action: DashboardQuickAction) => {
      if (action === "new_customer") navigate("customers");
      else if (action === "new_contract") navigate("contracts");
      else if (action === "new_receipt") {
        setVouchersMode("receipt");
        navigate("vouchers");
      } else if (action === "new_payment") {
        setVouchersMode("payment");
        navigate("vouchers");
      } else if (action === "new_subcontractor") navigate("subcontractors");
    },
    [navigate]
  );

  // فتح شاشة الكشوفات بهدف مسبق (من تبويب كشف الحساب بتفاصيل العقد)
  const openStatement = React.useCallback(
    (target: StatementTarget) => {
      setStatementTarget(target);
      navigate("statement");
    },
    [navigate]
  );

  // نتيجة بحث: عميل ⇒ فتح ملف العميل مباشرة (صفحة داخلية كالمكتبي)
  const openCustomerDetail = openCustomerFile;

  // نتيجة بحث: سند ⇒ شاشة السندات مع فلتر q
  const openVouchersWithQ = React.useCallback(
    (q: string) => {
      setVouchersPresetQ(q);
      navigate("vouchers");
    },
    [navigate]
  );

  // زر «عقد جديد» من شاشة العملاء ⇒ فتح معالج العقد مع العميل محددًا مسبقًا
  const startNewContractForCustomer = React.useCallback(
    (customerId: number) => {
      setNewContractCustomerId(customerId);
      navigate("contracts");
    },
    [navigate]
  );

  if (authQuery.isLoading) return <AuthSplash />;
  if (authQuery.isError) return <AuthSplash error />;

  if (!user) return <LoginView onLoggedIn={handleLoggedIn} />;

  return (
    <AppShell
      user={user}
      activeNav={activeNav}
      onSelectChild={selectChild}
      onLogout={handleLogout}
      onOpenSearch={() => setSearchOpen(true)}
      perms={perms}
      onOpenTransaction={(txType, txId) => {
        if (txType === "contract") openContract(txId);
      }}
    >
      {view === "dashboard" && (
        <DashboardView user={user} onAuthError={onAuthError} perms={perms} onQuickAction={handleDashboardQuickAction} onOpenContract={openContract} onOpenCustomerFile={openCustomerFile} onOpenTasks={() => navigate("tasks")} />
      )}
      {view === "due" && (
        <DueItemsView user={user} onAuthError={onAuthError} onOpenContract={openContract} />
      )}
      {view === "customers" && (
        <CustomersView
          user={user}
          onAuthError={onAuthError}
          onNewContract={startNewContractForCustomer}
          onOpenCustomerFile={openCustomerFile}
        />
      )}
      {view === "customer-file" && customerFileId !== null && (
        <CustomerFilePage
          customerId={customerFileId}
          user={user}
          onBack={() => navigate("customers")}
          onAuthError={onAuthError}
          onNewContract={startNewContractForCustomer}
          onOpenStatement={openStatement}
          onOpenCommentsCenter={() => navigate("comments")}
        />
      )}
      {view === "contracts" && (
        <ContractsView
          user={user}
          onAuthError={onAuthError}
          onOpenContract={openContract}
          presetCustomerId={newContractCustomerId}
          onConsumePreset={() => setNewContractCustomerId(null)}
        />
      )}
      {view === "contract-groups" && <ContractGroupsView user={user} onAuthError={onAuthError} />}
      {view === "forms" && <FormsCenterView user={user} onAuthError={onAuthError} />}
      {view === "contract" && contractId !== null && (
        <ContractDetailView
          contractId={contractId}
          user={user}
          onBack={() => navigate("contracts")}
          onAuthError={onAuthError}
          onOpenStatement={openStatement}
          onOpenCustomerFile={openCustomerFile}
        />
      )}
      {view === "vouchers" && (
        <VouchersView
          user={user}
          onAuthError={onAuthError}
          presetQ={vouchersPresetQ}
          onConsumePresetQ={() => setVouchersPresetQ(null)}
          initialMode={vouchersMode}
        />
      )}
      {view === "custody" && <CustodyView user={user} onAuthError={onAuthError} />}
      {view === "advances" && <AdvancesView user={user} onAuthError={onAuthError} />}
      {view === "invoices" && <InvoicesView user={user} onAuthError={onAuthError} />}
      {view === "gateway" && <GatewayView user={user} onAuthError={onAuthError} />}
      {view === "other-company" && <OtherCompanyView user={user} onAuthError={onAuthError} />}
      {view === "subcontractors" && <SubcontractorsView user={user} onAuthError={onAuthError} />}
      {view === "reports" && (
        <ReportsView user={user} onAuthError={onAuthError} selected={reportsKey} onSelect={setReportsKey} />
      )}
      {view === "statement" && (
        <StatementView
          user={user}
          onAuthError={onAuthError}
          presetTarget={statementTarget}
          onConsumePreset={() => setStatementTarget(null)}
        />
      )}
      {view === "followup" && <FollowupView user={user} onAuthError={onAuthError} onOpenContract={openContract} />}
      {view === "claims" && <ClaimsView user={user} onAuthError={onAuthError} />}
      {view === "tasks" && <TasksView user={user} onAuthError={onAuthError} />}
      {view === "visits" && <VisitsView user={user} onAuthError={onAuthError} />}
      {view === "comments" && (
        <CommentsView
          user={user}
          onAuthError={onAuthError}
          onOpenCustomer={openCustomerDetail}
          onOpenContract={openContract}
        />
      )}
      {view === "settings" && (
        <SettingsView user={user} onAuthError={onAuthError} initialSection={settingsSection} />
      )}
      {view === "users" && <UsersView user={user} onAuthError={onAuthError} />}
      {view === "data-mgmt" && (
        <DataManagementView user={user} onAuthError={onAuthError} initialSection={dmSection} />
      )}

      {/* البحث الشامل — Ctrl+K أو زر الشريط العلوي */}
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={navigate}
        onOpenContract={openContract}
        onOpenCustomerDetail={openCustomerDetail}
        onOpenVouchersWithQ={openVouchersWithQ}
      />
    </AppShell>
  );
}

function AuthSplash({ error }: { error?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="text-2xl font-extrabold text-primary tracking-tight">ConTrack</div>
      {error ? (
        <p className="text-sm text-destructive">تعذر الاتصال بالخادم — حاول تحديث الصفحة</p>
      ) : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">جارٍ التحقق من الجلسة…</span>
        </div>
      )}
    </div>
  );
}
