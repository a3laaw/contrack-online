"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { apiGet, apiPost, setStoredToken, clearStoredToken, ApiError } from "./api";
import type { StatementTarget, User, ViewName, ProjectsSection } from "./contrack-types";
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
import { ContractProgressView } from "./ContractProgressView";
import { ContractGroupsView } from "./ContractGroupsView";
import { StagePaymentsView } from "./StagePaymentsView";
import { FormsCenterView } from "./FormsCenterView";
import { ContractDetailView } from "./ContractDetailView";
import { VouchersView } from "./VouchersView";
import { CustodyView } from "./CustodyView";
import { AdvancesView } from "./AdvancesView";
import { InvoicesView } from "./InvoicesView";
import { GatewayView } from "./GatewayView";
import { OtherCompanyView } from "./OtherCompanyView";
import { ChartOfAccountsView } from "./ChartOfAccountsView";
import { JournalEntriesView } from "./JournalEntriesView";
import { LedgerView } from "./LedgerView";
import { FiscalPeriodsView } from "./FiscalPeriodsView";
import { FinancialStatementsView } from "./FinancialStatementsView";
import { BankReconView } from "./BankReconView";
import { ZakatXbrlView } from "./ZakatXbrlView";
import { SubcontractorsView } from "./SubcontractorsView";
import { ConsultingView, type ConsultingSection } from "./ConsultingView";
import { HRView, type HRSection } from "./HRView";
import { WarehousesView, type WarehousesSection } from "./WarehousesView";
import { SalesView } from "./SalesView";
import { QuotationsContractsView } from "./QuotationsContractsView";
import type { QuotationContractPreset, QuotationRow } from "@/lib/quotes-core";
import { MaintenanceView, type MaintenanceSection } from "./MaintenanceView";
import { ProjectsView } from "./ProjectsView";
import { RefListsView, type RefListsSection } from "./RefListsView";
import { ReportsView } from "./ReportsView";
import { ReportsHomeView } from "./ReportsHomeView";
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
import { DevConsoleView } from "./DevConsoleView";

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

  // لوحة المطور (Task 97): علامة فتح اللوحة بعد الدخول/العودة من شركة — تُقرأ مرة ثم تُمسح
  const [view, setView] = React.useState<ViewName>(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("ctrk_open_view") === "dev-console") {
      return "dev-console";
    }
    return "dashboard";
  });
  React.useEffect(() => {
    sessionStorage.removeItem("ctrk_open_view");
  }, []);
  const [contractId, setContractId] = React.useState<number | null>(null);
  const [customerFileId, setCustomerFileId] = React.useState<number | null>(null);
  const [newContractCustomerId, setNewContractCustomerId] = React.useState<number | null>(null);

  // ===== حالات الشاشات الجديدة (المهمة 10-b) =====
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [statementTarget, setStatementTarget] = React.useState<StatementTarget | null>(null);
  const [vouchersPresetQ, setVouchersPresetQ] = React.useState<string | null>(null);
  // Task 106 — فتح قيد سند في القيود اليومية بالبحث برقمه
  const [journalPresetQ, setJournalPresetQ] = React.useState<string | null>(null);

  // ===== وضع السندات وأقسام الإعدادات وإدارة البيانات والتقارير والاستشارات (هيكل التنقل المعتمد) =====
  const [vouchersMode, setVouchersMode] = React.useState<"receipt" | "payment">("receipt");
  const [settingsSection, setSettingsSection] = React.useState<string>("company");
  // قسم إدارة البيانات — بند شل وحيد (الجلسة 14) يفتح شاشة الحوكمة بتاب «النسخ» الافتراضي
  const [dmSection, setDmSection] = React.useState<string>("backup");
  const [reportsKey, setReportsKey] = React.useState<string>(DEFAULT_REPORT_KEY);
  const [consultingSection, setConsultingSection] = React.useState<ConsultingSection>("team");
  const [hrSection, setHrSection] = React.useState<HRSection>("team");
  // المخازن — قسم الشاشة الموحدة (مرآة أقسام HR/الاستشارات)
  const [warehousesSection, setWarehousesSection] = React.useState<WarehousesSection>("items");
  // المبيعات — نقاط البيع حصرًا بعد نقل العروض إلى وحدة qc (قرار المالك)
  // وحدة «العقود وعروض الأسعار» — عرض مقبول يتحول إلى عقد: معالج العقد يُفتح معبأً في تبويب العقود
  const [quoteContractPreset, setQuoteContractPreset] = React.useState<QuotationContractPreset | null>(null);
  // الصيانة والتشغيل — قسم الشاشة الموحدة (عقود/جدول/أوامر)
  const [maintenanceSection, setMaintenanceSection] = React.useState<MaintenanceSection>("contracts");
  // المشاريع — قسم مركز عمليات الموقع (لوحة/تقرير يومي/تنفيذ بنود)
  const [projectsSection, setProjectsSection] = React.useState<ProjectsSection>("hub");
  // القوائم المرجعية — قسم الشاشة الموحدة الافتراضي (الأنواع والمراحل والدفعات) ثم بقية الأقسام
  const [refListsSection, setRefListsSection] = React.useState<RefListsSection>("types-stages-payments");

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
        : view === "consulting"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "consulting" && c.section === consultingSection)?.id ??
          "consulting-team")
        : view === "hr"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "hr" && c.section === hrSection)?.id ??
          "hr-team")
        : view === "warehouses"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "warehouses" && c.section === warehousesSection)?.id ??
          "wh-items")
        : view === "sales"
        ? "sales-pos"
        // وحدة «العقود وعروض الأسعار» — قسم العروض (العقود/التقدم/المجموعات تُحلّ بمطابقة view نفسه)
        : view === "quotes-contracts"
        ? "qc-quotes"
        : view === "maintenance"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "maintenance" && c.section === maintenanceSection)?.id ??
          "mt-contracts")
        : view === "projects"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "projects" && c.section === projectsSection)?.id ??
          "projects-hub")
        : view === "ref-lists"
        ? (NAV_MODULES.flatMap((m) => m.children).find((c) => c.view === "ref-lists" && c.section === refListsSection)?.id ??
          "ref-lists")
        : view === "data-mgmt"
          ? "data-mgmt"
          : view;

  const user = authQuery.data?.user ?? null;
  const perms = authQuery.data?.perms ?? null;
  const manager = isManagerRole(user?.role);
  const isDeveloper = user?.role === "developer";
  // بند 5: مرآة has_permission المكتبي — الدور أولًا (المدير/المطور الكل دائمًا) ثم
  // الخريطة (الممنوع=false فقط يُرفض) والمفتاح المجهول/غير المحمّل لا يقيّد
  const permOn = React.useCallback((k: string) => permAllows(perms, k, manager), [perms, manager]);

  // اختيار بند من القائمة الجانبية — حرس التنقل الحرفي أولًا (مرآة _navigate: main_window.py:1984-1988):
  // بند شل بلا صلاحية لا يُفتح ويظهر توست المكتبي الحرفي — والميزات لا تمنع الفتح (تخفي الزر فقط)
  const selectChild = React.useCallback(
    (child: NavChild) => {
      if (!isChildVisible(child, { isAdmin: manager, isDeveloper, flagOn: () => true, permOn })) {
        toast({ title: NAVIGATE_DENIED_MSG });
        return;
      }
      if (child.view === "vouchers" && child.mode) setVouchersMode(child.mode);
      if (child.view === "settings" && child.section) setSettingsSection(child.section);
      if (child.view === "data-mgmt" && child.section) setDmSection(child.section);
      if (child.view === "reports" && child.report) setReportsKey(child.report);
      if (child.view === "consulting" && child.section) setConsultingSection(child.section as ConsultingSection);
      if (child.view === "hr" && child.section) setHrSection(child.section as HRSection);
      if (child.view === "warehouses" && child.section) setWarehousesSection(child.section as WarehousesSection);
      if (child.view === "maintenance" && child.section) setMaintenanceSection(child.section as MaintenanceSection);
      if (child.view === "projects" && child.section) setProjectsSection(child.section as ProjectsSection);
      if (child.view === "ref-lists" && child.section) setRefListsSection(child.section as RefListsSection);
      setView(child.view);
      if (child.view !== "contract") setContractId(null);
      if (child.view !== "customer-file") setCustomerFileId(null);
    },
    [manager, isDeveloper, permOn, toast]
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
      // Task 100: المطور غير مربوط بأي شركة — لوحته هي بوابة الدخول الوحيدة، يُفتتح بها مباشرة؛
      // البقية يُفتتحون بشركتهم كالسابق
      setView(u.role === "developer" ? "dev-console" : "dashboard");
      setContractId(null);
    },
    [qc]
  );

  const handleLogout = React.useCallback(async () => {
    clearStoredToken(); // أولاً — أي طلب لاحق يخرج بلا توكن
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* الجلسة قد تكون منتهية أصلًا */
    }
    // إصلاح الخروج: qc.clear() كان يفصل مراقب استعلام auth المُركَّب عن الكاش فيكتب
    // setQueryData التالي {user:null} في مدخل لا يراقبه أحد — فتبقى الواجهة «داخل النظام»
    // رغم موت الجلسة. الصواب: إلغاء الجلبات الجارية، إزالة كل استعلامات التطبيق عدا auth
    // (يبقى المراقب مرتبطًا بمدخله)، ثم تصفير بيانات auth مباشرة فتتحول الشاشة للدخول فورًا.
    qc.cancelQueries();
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
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
      if (!canOpenView(v, { isAdmin: manager, isDeveloper: user?.role === "developer", permOn })) {
        toast({ title: NAVIGATE_DENIED_MSG });
        return;
      }
      setView(v);
      if (v !== "contract") setContractId(null);
      if (v !== "customer-file") setCustomerFileId(null);
    },
    [manager, permOn, toast, user?.role]
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

  // Task 106 — فتح قيد مرتبط بسند في القيود اليومية بالبحث برقمه
  const openJournalWithQ = React.useCallback(
    (entryNo: string) => {
      setJournalPresetQ(entryNo);
      navigate("journal-entries");
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

  // وحدة «العقود وعروض الأسعار» — تحويل عرض مقبول إلى عقد (قرار المالك):
  // يُبنى التعبئة المسبقة (العميل + الاسم من وصف العرض + القيمة من الإجمالي) ويُفتح
  // تبويب العقود حيث يفتح ContractsView معالج العقد معبأً — ويُوسم العرض آليًا بعد الإنشاء
  const convertQuoteToContract = React.useCallback(
    (q: QuotationRow) => {
      setQuoteContractPreset({
        quotationId: q.id,
        quotationNumber: q.quotationNumber,
        customerId: q.customerId,
        customerName: q.customerName,
        name: q.description?.trim() ? q.description.trim() : `عقد من عرض السعر ${q.quotationNumber}`,
        amount: String(q.totalAmount ?? ""),
      });
      navigate("contracts");
    },
    [navigate]
  );

  // لوحة المطور (Task 97/100): «رجوع للوحة» من شريط التمييز أو زر الدرع —
  // المطور بلا شركة: إن كان داخل شركة يُعاد إصدار التوكن بسياق 0 (بلا شركة) ثم إعادة تحميل
  // بعلامة فتح اللوحة؛ وإن كان بلا شركة أصلًا فتح مباشر
  const returnToDevConsole = React.useCallback(() => {
    sessionStorage.setItem("ctrk_open_view", "dev-console");
    if (!user?.companyId) {
      setView("dev-console");
      return;
    }
    apiPost<{ token: string }>("/api/companies/switch", { companyId: 0 })
      .then((res) => {
        setStoredToken(res.token);
        window.location.reload();
      })
      .catch(() => setView("dev-console"));
  }, [user]);

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
      onOpenDevConsole={user.role === "developer" ? returnToDevConsole : undefined}
      onReturnToDevConsole={returnToDevConsole}
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
          presetFromQuote={quoteContractPreset}
          onConsumeQuotePreset={() => setQuoteContractPreset(null)}
        />
      )}
      {/* وحدة «العقود وعروض الأسعار» المستقلة (قرار المالك) — قسم العروض مع التحويل إلى عقد */}
      {view === "quotes-contracts" && (
        <QuotationsContractsView user={user} onAuthError={onAuthError} onConvertToContract={convertQuoteToContract} />
      )}
      {/* لوحة «أين وصلنا» — ربط العقود بمراحل العمل وموقع التقدم (قرار المالك 2026-11) */}
      {view === "contract-progress" && (
        <ContractProgressView user={user} perms={perms} onAuthError={onAuthError} onOpenContract={openContract} />
      )}
      {view === "contract-groups" && <ContractGroupsView user={user} onAuthError={onAuthError} />}
      {/* الشاشة الموحدة «المراحل والدفعات» — قرار المالك: عقد ← مرحلة ← دفعاتها في صفحة واحدة */}
      {view === "stage-payments" && <StagePaymentsView user={user} onAuthError={onAuthError} />}
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
          onOpenJournal={openJournalWithQ}
        />
      )}
      {view === "custody" && <CustodyView user={user} onAuthError={onAuthError} />}
      {view === "advances" && <AdvancesView user={user} onAuthError={onAuthError} />}
      {view === "invoices" && <InvoicesView user={user} onAuthError={onAuthError} onOpenJournal={openJournalWithQ} />}
      {view === "gateway" && <GatewayView user={user} onAuthError={onAuthError} />}
      {view === "other-company" && <OtherCompanyView user={user} onAuthError={onAuthError} />}
      {view === "chart-of-accounts" && <ChartOfAccountsView onAuthError={onAuthError} />}
      {view === "journal-entries" && (
        <JournalEntriesView user={user} onAuthError={onAuthError} presetQ={journalPresetQ} onConsumePresetQ={() => setJournalPresetQ(null)} />
      )}
      {view === "ledger" && <LedgerView onAuthError={onAuthError} />}
      {view === "fiscal-close" && <FiscalPeriodsView user={user} onAuthError={onAuthError} />}
      {view === "financial-statements" && <FinancialStatementsView onAuthError={onAuthError} />}
      {view === "bank-recon" && <BankReconView user={user} onAuthError={onAuthError} />}
      {view === "zakat-xbrl" && <ZakatXbrlView user={user} onAuthError={onAuthError} />}
      {view === "subcontractors" && <SubcontractorsView user={user} onAuthError={onAuthError} />}
      {view === "consulting" && (
        <ConsultingView
          user={user}
          onAuthError={onAuthError}
          section={consultingSection}
          onSectionChange={setConsultingSection}
        />
      )}
      {view === "hr" && <HRView user={user} onAuthError={onAuthError} section={hrSection} onSectionChange={setHrSection} />}
      {view === "warehouses" && (
        <WarehousesView user={user} onAuthError={onAuthError} section={warehousesSection} />
      )}
      {view === "sales" && <SalesView onAuthError={onAuthError} onOpenQuotes={() => navigate("quotes-contracts")} />}
      {view === "maintenance" && (
        <MaintenanceView
          user={user}
          onAuthError={onAuthError}
          section={maintenanceSection}
          onOpenContract={openContract}
        />
      )}
      {view === "projects" && (
        <ProjectsView
          user={user}
          onAuthError={onAuthError}
          section={projectsSection}
          onSectionChange={setProjectsSection}
          onOpenContract={openContract}
        />
      )}
      {view === "ref-lists" && (
        <RefListsView
          user={user}
          onAuthError={onAuthError}
          section={refListsSection}
          onSectionChange={setRefListsSection}
          onOpenDocTemplates={() => {
            navigate("ref-lists");
            setRefListsSection("doc-templates");
          }}
        />
      )}
      {view === "reports-home" && (
        <ReportsHomeView
          user={user}
          perms={perms}
          onOpenReport={(key) => {
            setReportsKey(key);
            navigate("reports");
          }}
          onOpenView={(v) => navigate(v as ViewName)}
        />
      )}
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
      {view === "dev-console" && user.role === "developer" && (
        <DevConsoleView user={user} onAuthError={onAuthError} />
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
      <div className="text-2xl font-extrabold text-primary-ink tracking-tight">ConTrack</div>
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
