"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { apiGet, apiPost, setStoredToken, clearStoredToken, ApiError } from "./api";
import type { StatementTarget, User, ViewName } from "./contrack-types";
import type { NavChild } from "./nav-structure";
import { NAV_MODULES } from "./nav-structure";
import { DueItemsView } from "./DueItemsView";
import { FeatureFlagsProvider } from "./FeatureFlagsProvider";
import { AppShell } from "./AppShell";
import { LoginView } from "./LoginView";
import { DashboardView } from "./DashboardView";
import { CustomersView } from "./CustomersView";
import { CustomerFilePage } from "./CustomerFilePage";
import { ContractsView } from "./ContractsView";
import { ContractDetailView } from "./ContractDetailView";
import { VouchersView } from "./VouchersView";
import { CustodyView } from "./CustodyView";
import { AdvancesView } from "./AdvancesView";
import { InvoicesView } from "./InvoicesView";
import { GatewayView } from "./GatewayView";
import { OtherCompanyView } from "./OtherCompanyView";
import { SubcontractorsView } from "./SubcontractorsView";
import { ReportsView } from "./ReportsView";
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

type AuthData = { user: User | null };

function AppRoot() {
  const qc = useQueryClient();

  const authQuery = useQuery<AuthData>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        const res = await apiGet<{ user: User }>("/api/auth/me");
        return { user: res.user };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return { user: null };
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

  // ===== وضع السندات وأقسام الإعدادات وإدارة البيانات (هيكل التنقل المعتمد) =====
  const [vouchersMode, setVouchersMode] = React.useState<"receipt" | "payment">("receipt");
  const [settingsSection, setSettingsSection] = React.useState<string>("company");
  const [dmSection, setDmSection] = React.useState<string>("backup");

  // معرّف البند النشط في القائمة الجانبية (يحدد الوحدة والبند المُبرز)
  const activeNav =
    view === "vouchers"
      ? vouchersMode === "payment"
        ? "vouchers-payment"
        : "vouchers-receipt"
      : view === "settings"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "settings" && c.section === settingsSection)?.id ??
          "settings-printing")
        : view === "data-mgmt"
          ? dmSection === "devtools"
            ? "devtools"
            : "backup"
          : view;

  // اختيار بند من القائمة الجانبية — يضبط العرض والأوضاع المرافقة
  const selectChild = React.useCallback((child: NavChild) => {
    if (child.view === "vouchers" && child.mode) setVouchersMode(child.mode);
    if (child.view === "settings" && child.section) setSettingsSection(child.section);
    if (child.view === "data-mgmt" && child.section) setDmSection(child.section);
    setView(child.view);
    if (child.view !== "contract") setContractId(null);
    if (child.view !== "customer-file") setCustomerFileId(null);
  }, []);

  const user = authQuery.data?.user ?? null;

  // أي 401 في أي شاشة ⇒ إعادة فحص الجلسة ⇒ عرض شاشة الدخول
  const onAuthError = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["auth"] });
  }, [qc]);

  const handleLoggedIn = React.useCallback(
    (u: User, token: string) => {
      setStoredToken(token);
      qc.setQueryData<AuthData>(["auth", "me"], { user: u });
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
    qc.setQueryData<AuthData>(["auth", "me"], { user: null });
    setView("dashboard");
    setContractId(null);
    setCustomerFileId(null);
    setNewContractCustomerId(null);
  }, [qc]);

  const openContract = React.useCallback((id: number) => {
    setContractId(id);
    setView("contract");
  }, []);

  // فتح ملف العميل كصفحة داخلية (كالمكتبي dealings._open_customer — استبدال المحتوى لا تكدس نوافذ)
  const openCustomerFile = React.useCallback((id: number) => {
    setCustomerFileId(id);
    setView("customer-file");
  }, []);

  const navigate = React.useCallback((v: ViewName) => {
    setView(v);
    if (v !== "contract") setContractId(null);
    if (v !== "customer-file") setCustomerFileId(null);
  }, []);

  // فتح شاشة الكشوفات بهدف مسبق (من تبويب كشف الحساب بتفاصيل العقد)
  const openStatement = React.useCallback((target: StatementTarget) => {
    setStatementTarget(target);
    setView("statement");
  }, []);

  // نتيجة بحث: عميل ⇒ فتح ملف العميل مباشرة (صفحة داخلية كالمكتبي)
  const openCustomerDetail = openCustomerFile;

  // نتيجة بحث: سند ⇒ شاشة السندات مع فلتر q
  const openVouchersWithQ = React.useCallback((q: string) => {
    setVouchersPresetQ(q);
    setView("vouchers");
  }, []);

  // زر «عقد جديد» من شاشة العملاء ⇒ فتح معالج العقد مع العميل محددًا مسبقًا
  const startNewContractForCustomer = React.useCallback((customerId: number) => {
    setNewContractCustomerId(customerId);
    setView("contracts");
  }, []);

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
    >
      {view === "dashboard" && (
        <DashboardView user={user} onAuthError={onAuthError} onNavigate={navigate} />
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
      {view === "contract" && contractId !== null && (
        <ContractDetailView
          contractId={contractId}
          user={user}
          onBack={() => navigate("contracts")}
          onAuthError={onAuthError}
          onOpenStatement={openStatement}
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
      {view === "reports" && <ReportsView user={user} onAuthError={onAuthError} />}
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
