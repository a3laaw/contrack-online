"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  BarChart3,
  BookText,
  Compass,
  Network,
  Timer,
  Scale,
  Landmark,
  FileBadge,
  ScrollText,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileSpreadsheet,
  FileStack,
  FileText,
  HandCoins,
  HardHat,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  ListChecks,
  ListTodo,
  ListTree,
  LockKeyhole,
  MessageSquareText,
  Receipt,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  UserCog,
  Users as UsersIcon,
  UsersRound,
  CalendarCheck2,
  Banknote,
  DatabaseBackup,
  Wallet,
  Wrench,
  // المخازن — أيقونات موديول المستودعات
  Package,
  PackagePlus,
  Warehouse,
  Boxes,
  // المبيعات — أيقونات موديول العروض والنقطة
  Store,
  Calculator,
  // الصيانة والتشغيل — أيقونات الموديول
  FileSignature,
  NotebookPen,
  // الاستشارات — رادار المواعيد (NOVA 4)
  Radar,
  // المشاريع — مركز عمليات الموقع
  FolderKanban,
  // القوائم المرجعية — مركز البيانات المرجعية
  BookMarked,
  // المناطق — الهرمية الجغرافية
  MapPin,
} from "lucide-react";

import type { ViewName } from "./contrack-types";
import { REPORTS, reportCategory } from "./reports-list";

/**
 * مواءمة تقارير الويب (reports-list keys) مع مفاتيح الصلاحيات المكتبية — المرحلة 2/ب:
 * كل تقرير بباب صلاحية مستقل كالمكتبي (تأشيرة مستقلة لكل تقرير).
 */
export const REPORT_PERM: Record<string, string> = {
  "customers-balances": "report_customers_balances",
  "stage-dues": "report_stage_dues",
  "supervision-delays": "report_supervision_delays",
  subcontractors: "report_subcontractors",
  vouchers: "report_vouchers",
  expenses: "report_expenses",
  cashflow: "report_cashflow",
  contracts: "report_contracts",
  execution: "report_execution",
  leads: "report_prospects",
  journal: "report_journal",
};

/** معرّف الوحدات المعتمدة (توجيه المستخدم — تبويبات علوية) */
export type ModuleId =
  | "clients"
  | "projects"
  | "subs"
  | "consulting"
  | "hr"
  | "warehouses"
  | "sales"
  | "maintenance"
  | "accounting"
  | "reports"
  // القوائم المرجعية (الجلسة 11) — مركز البيانات المرجعية المشتركة بين كل الأنشطة
  | "refs"
  | "settings";

/** بند فرعي داخل وحدة — الشاشة الواحدة مستوى تنقل فرعي واحد فقط */
export interface NavChild {
  /** معرّف فريد للتمييز عند تكرار نفس view بأوضاع/أقسام مختلفة */
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view: ViewName;
  /** وضع شاشة السندات: receipt | payment */
  mode?: "receipt" | "payment";
  /** قسم داخل شاشة الإعدادات أو إدارة البيانات */
  section?: string;
  /** مفتاح التقرير داخل شاشة مركز التقارير (view=reports) */
  report?: string;
  adminOnly?: boolean;
  /** يظهر للمطور حصرًا (is_developer) — نمط Task 97: بابان معًا يستثني المدير والسكرتير */
  developerOnly?: boolean;
  /** مفتاح الميزة (feature_flags) الذي يخفي البند عند تعطيله — كالشجرة المكتبية */
  flag?: string;
  /** مفتاح الصلاحية (المواءمة المكتبية) الذي يخفي البند عن من لا يملكه — المرحلة 2/ب */
  perm?: string;
  /** ترويسة مجموعة داخل القائمة الجانبية — تُعرض قبل البند أول مرة يتغير فيها (Task 114) */
  groupLabel?: string;
}

/**
 * قسم علوي في الشريط (التحول الطرازي العلوي — الجلسة 15، قرار المالك «كله علوي»):
 *   بند واحد ⇒ رابط مباشر بلا ▾ · أكثر من بند ⇒ قائمة منسدلة (بلا ترويسات مجموعات).
 *   label اختياري لاختصار عنوان القسم — أسماء البنود داخل القائمة تبقى حرفية.
 *   children يجب أن تغطي بنود الوحدة مرة واحدة بالضبط (حارس اختباري — tests/nav-top-structure.test.ts).
 *   الوحدة بلا top = كل بنودها أقسامًا مباشرة بالترتيب.
 */
export interface NavTopSection {
  id: string;
  label?: string;
  children: string[];
}

export interface NavModule {
  id: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavChild[];
  /** أقسام الشريط العلوي — غيابها = كل البنود روابط مباشرة */
  top?: NavTopSection[];
}

/**
 * هيكل التنقل المعتمد (6 تبويبات — تبويب الاستشارات موديول مستقل يظهر لمن فعّله):
 *   1. العقود: اللوحة، المستحقات، العملاء، العقود، مجموعات العقود، مركز النماذج، المهام، الزيارات، التعليقات، المتابعة
 *   2. المشاريع: مركز عمليات الموقع بعقلية مهندس مدير الموقع — لوحة المشاريع، التقرير اليومي
 *      (تجميع اشتقاقي فوق سجلات التنفيذ الميداني — لا جدول جديد G9 — docs/daily-report-forecast-design.md)،
 *      تنفيذ البنود (مقايسة التنفيذ بالبنود: تعاقدي/منفذ/موثق/مفوتر)
 *   3. الباطن: مقاولو الباطن (ملف المقاول: العقود والدفعات والأوامر)
 *   4. الاستشارات: الفريق الهندسي، إسناد المشاريع، ساعات العمل، الإجازات (موديول consulting)
 *   5. المحاسبة: سندات القبض/الصرف، كشف الحساب، العُهد، السلف، البوابة، الشركة الأخرى، المطالبات، الفواتير
 *   6. التقارير: التقارير الـ11 بنودًا حقيقية في القائمة الجانبية الرسمية كالمحاسبة (توجيه المستخدم — الخيار 2)
 *   7. الإعدادات: الشركة، الطباعة، الأمان، المستخدمون، جدول الكميات BOQ، الزيارات، قواعد الترحيل، النسخ، أدوات المطور
 *      (الجلسة 12 — قرار المالك: «أنواع العقود» و«مراحل العمل» انتقلتا حصرًا إلى وحدة القوائم المرجعية
 *       وحُذف تابيهما المكرر من الإعدادات)
 * خارج النطاق (لا يُضاف): عروض الأسعار، الأرشيف، الواتساب، الاستيراد من Excel.
 */
export const NAV_MODULES: NavModule[] = [
  {
    id: "clients",
    label: "العقود",
    icon: FileText,
    children: [
      { id: "dashboard", label: "اللوحة", icon: LayoutDashboard, view: "dashboard", perm: "screen_customers" },
      { id: "due", label: "المهام المستحقة", icon: CalendarClock, view: "due", perm: "screen_customers" },
      { id: "customers", label: "العملاء", icon: UsersIcon, view: "customers", perm: "screen_customers" },
      { id: "contracts", label: "العقود", icon: FileText, view: "contracts", perm: "screen_customers" },
      // الشاشة الموحدة «المراحل والدفعات» — قرار المالك: أنواع العقود ومراحل العمل والدفعات في صفحة واحدة
      { id: "stage-payments", label: "المراحل والدفعات", icon: ListTree, view: "stage-payments", perm: "screen_customers" },
      { id: "contract-groups", label: "مجموعات العقود", icon: Layers, view: "contract-groups", perm: "screen_customers" },
      // بند 56: موضع المكتبي بند شل مشروط بمفتاح المزايا «forms_center» وصلاحية
      // screen_forms معًا (main_window.py:812-814) — والبند تحت وحدة العقود كشاشة العمل
      { id: "forms", label: "مركز النماذج", icon: LayoutTemplate, view: "forms", flag: "forms_center", perm: "screen_forms" },
      { id: "tasks", label: "المهام", icon: ListTodo, view: "tasks", flag: "tasks", perm: "screen_tasks" },
      { id: "visits", label: "جدول الزيارات", icon: CalendarDays, view: "visits", flag: "visits", perm: "screen_visits" },
      { id: "comments", label: "التعليقات", icon: MessageSquareText, view: "comments", flag: "comments", perm: "screen_customers" },
      { id: "followup", label: "المتابعة", icon: ClipboardList, view: "followup", flag: "followup", perm: "screen_followup" },
    ],
    // الجلسة 15 — أقسام الشريط العلوي (10 بنود ← 5 أقسام): «المهام المستحقة» أول بند في قائمة المهام
    top: [
      { id: "t-clients-home", children: ["dashboard"] },
      { id: "t-clients-customers", label: "العملاء والعقود", children: ["customers", "contracts", "stage-payments", "contract-groups"] },
      { id: "t-clients-forms", children: ["forms"] },
      { id: "t-clients-tasks", label: "المهام والزيارات", children: ["due", "tasks", "visits"] },
      { id: "t-clients-followup", label: "المتابعة والتعليقات", children: ["comments", "followup"] },
    ],
  },
  {
    // المشاريع (مركز عمليات الموقع) — بعقلية مهندس مدير الموقع: صباحًا لوحة كل مشاريعه،
    // أثناء اليوم التقرير اليومي (اشتقاقي فوق FieldExecution — بلا جدول جديد G9)،
    // ومتابعة تفصيلية لتنفيذ البنود — ملك نشاط المقاولات (modules-catalog)
    id: "projects",
    label: "المشاريع",
    icon: FolderKanban,
    children: [
      { id: "projects-hub", label: "لوحة المشاريع", icon: LayoutGrid, view: "projects", section: "hub", perm: "screen_projects" },
      { id: "projects-daily", label: "التقرير اليومي", icon: NotebookPen, view: "projects", section: "daily", perm: "screen_projects" },
      { id: "projects-takeoff", label: "تنفيذ البنود", icon: ListChecks, view: "projects", section: "takeoff", perm: "screen_projects" },
    ],
  },
  {
    id: "subs",
    label: "الباطن",
    icon: HardHat,
    children: [
      { id: "subcontractors", label: "مقاولو الباطن", icon: HardHat, view: "subcontractors", flag: "subcontractors", perm: "screen_subcontractors" },
    ],
  },
  {
    // الاستشارات الهندسية — موديول مستقل (navModules للكتالوج) يظهر حصرًا للشركات التي فعّلته،
    // ويختفي دفعة واحدة عند إيقافه (تجميد قراءة فقط) — كالمكتبية بلا أي شروط إضافية
    id: "consulting",
    label: "الاستشارات",
    icon: Compass,
    children: [
      { id: "consulting-team", label: "الفريق الهندسي", icon: UsersRound, view: "consulting", section: "team", perm: "screen_consulting" },
      { id: "consulting-assignments", label: "إسناد المشاريع", icon: Network, view: "consulting", section: "assignments", perm: "screen_consulting" },
      { id: "consulting-timesheets", label: "ساعات العمل", icon: Timer, view: "consulting", section: "timesheets", perm: "screen_consulting" },
      { id: "consulting-revisions", label: "مراجعات المخططات", icon: FileStack, view: "consulting", section: "revisions", perm: "screen_consulting" },
      { id: "consulting-leaves", label: "الإجازات", icon: CalendarDays, view: "consulting", section: "leaves", perm: "screen_consulting" },
      { id: "consulting-radar", label: "رادار المواعيد", icon: Radar, view: "consulting", section: "radar", perm: "screen_consulting" },
    ],
    // الجلسة 15 — أقسام مباشرة بعناوين مختصرة (6 بنود ← 6 أقسام) لتثبيت عرض الشريط
    top: [
      { id: "t-con-team", children: ["consulting-team"] },
      { id: "t-con-assign", label: "الإسناد", children: ["consulting-assignments"] },
      { id: "t-con-timesheets", children: ["consulting-timesheets"] },
      { id: "t-con-revisions", label: "المراجعات", children: ["consulting-revisions"] },
      { id: "t-con-leaves", children: ["consulting-leaves"] },
      { id: "t-con-radar", children: ["consulting-radar"] },
    ],
  },
  {
    // الموارد البشرية (HR-1) — موديول مستقل: الموظف الموحد (توسعة كيان السلف القائم) + الحضور اليدوي
    // + الإجازات بآلة الحالات + مسير الرواتب بخط أنابيب واحد للمحرك الموحد + السلف (النظام القائم)
    id: "hr",
    label: "الموارد البشرية",
    icon: UsersIcon,
    children: [
      { id: "hr-team", label: "الموظفون", icon: UsersIcon, view: "hr", section: "team", perm: "screen_hr" },
      { id: "hr-attendance", label: "الحضور", icon: CalendarCheck2, view: "hr", section: "attendance", perm: "screen_hr" },
      { id: "hr-leaves", label: "الإجازات", icon: CalendarDays, view: "hr", section: "leaves", perm: "screen_hr" },
      { id: "hr-permissions", label: "الأذونات", icon: Timer, view: "hr", section: "permissions", perm: "screen_hr" },
      { id: "hr-payroll", label: "مسير الرواتب", icon: Banknote, view: "hr", section: "payroll", perm: "screen_hr" },
      { id: "hr-advances", label: "سلف الموظفين", icon: HandCoins, view: "hr", section: "advances", perm: "screen_hr" },
      { id: "hr-eos", label: "نهاية الخدمة", icon: DoorOpen, view: "hr", section: "eos", perm: "screen_hr" },
      // HR-3 — الأطقم والتكليفات وتوزيع تكلفة العمالة على العقود
      { id: "hr-labor", label: "الأطقم والتكليفات", icon: Network, view: "hr", section: "labor", perm: "screen_hr" },
      { id: "hr-reports", label: "التقارير", icon: ClipboardList, view: "hr", section: "reports", perm: "screen_hr" },
    ],
    // الجلسة 15 — 9 بنود ← 6 أقسام
    top: [
      { id: "t-hr-team", children: ["hr-team"] },
      { id: "t-hr-att", label: "الحضور والإجازات", children: ["hr-attendance", "hr-leaves", "hr-permissions"] },
      { id: "t-hr-payroll", label: "الرواتب", children: ["hr-payroll"] },
      { id: "t-hr-advances", label: "السلف", children: ["hr-advances"] },
      { id: "t-hr-eos", children: ["hr-eos"] },
      { id: "t-hr-labor", label: "الأطقم والتقارير", children: ["hr-labor", "hr-reports"] },
    ],
  },
  {
    // المخازن (docs/warehouses-design.md) — أصناف ومستودعات وأذون الحركة الأربعة والأرصدة الاشتقاقية
    id: "warehouses" as ModuleId,
    label: "المخازن",
    icon: Package,
    children: [
      { id: "wh-items", label: "الأصناف والمستودعات", icon: Warehouse, view: "warehouses", section: "items", perm: "screen_warehouses" },
      { id: "wh-docs", label: "أذون المخازن", icon: PackagePlus, view: "warehouses", section: "docs", perm: "screen_warehouses" },
      { id: "wh-balances", label: "الأرصدة والتقارير", icon: Boxes, view: "warehouses", section: "balances", perm: "screen_warehouses" },
    ],
  },
  {
    // المبيعات (docs/sales-design.md §6): عروض الأسعار ببيت مستقل + نقاط البيع السريع — الفواتير تبقى بملكية المحاسبة
    id: "sales" as ModuleId,
    label: "المبيعات",
    icon: Store,
    children: [
      { id: "sales-quotes", label: "عروض الأسعار", icon: FileText, view: "sales", section: "quotes", perm: "screen_sales" },
      { id: "sales-pos", label: "نقاط البيع", icon: Calculator, view: "sales", section: "pos", perm: "screen_sales" },
    ],
  },
  {
    // الصيانة والتشغيل (docs/maintenance-design.md §6): عقود الصيانة بنوع موسوم · الجدول الوقائي المولّد · أوامر العمل MO
    id: "maintenance" as ModuleId,
    label: "الصيانة والتشغيل",
    icon: Wrench,
    children: [
      { id: "mt-contracts", label: "عقود الصيانة", icon: FileSignature, view: "maintenance", section: "contracts", perm: "screen_maintenance" },
      { id: "mt-schedule", label: "الجدول الوقائي", icon: CalendarClock, view: "maintenance", section: "schedule", perm: "screen_maintenance" },
      { id: "mt-orders", label: "أوامر العمل", icon: NotebookPen, view: "maintenance", section: "orders", perm: "screen_maintenance" },
    ],
  },
  {
    id: "accounting",
    label: "المحاسبة",
    icon: Wallet,
    children: [
      // Task 102 — المحاسبة الكاملة: دليل الحسابات أرضية البرنامج المحاسبي
      // بخريطة XBRL الكويتي وجسر المصروفات — خلف ميزة full_accounting وصلاحية مستقلة
      // (بلا adminOnly: صاحب العمل سكرتير هنا — الباب صلاحية screen_chart_of_accounts)
      { id: "chart-of-accounts", label: "دليل الحسابات", icon: BookText, view: "chart-of-accounts", perm: "screen_chart_of_accounts" },
      // Task 104 — القيود اليومية: نواة القيد المزدوج الحقيقية (نشر/إلغاء/عكس عبر المحرك الموحد)
      { id: "journal-entries", label: "القيود اليومية", icon: ScrollText, view: "journal-entries", perm: "screen_journal_entries" },
      // Task 108 — دفتر الأستاذ + ميزان المراجعة + أعمار الذمم: مخرجات الأستاذ (مصدر الحقيقة)
      { id: "ledger", label: "دفتر الأستاذ والميزان", icon: Scale, view: "ledger", perm: "screen_ledger" },
      // Task 110 — القوائم المالية الموحدة (القرار الوزاري 44/2016) من الأستاذ حصرًا + فحوص التوازن
      { id: "financial-statements", label: "القوائم المالية", icon: Landmark, view: "financial-statements", perm: "screen_financial_statements" },
      // Task 113 — التسوية البنكية: مطابقة كشوف البنك مع الأستاذ + تقرير الفوارق
      { id: "bank-recon", label: "التسوية البنكية", icon: ArrowLeftRight, view: "bank-recon", perm: "screen_bank_recon" },
      // Task 111 — الزكاة 1% وضريبة الأجانب 15% + مصدّر iXBRL للتقديم الإلكتروني
      { id: "zakat-xbrl", label: "الزكاة والتقديم", icon: FileBadge, view: "zakat-xbrl", perm: "screen_zakat_xbrl" },
      // Task 109 — الفترات المالية والإقفال السنوي الموثق (قفل الشهور + قيد الإغلاق + الافتتاحية)
      { id: "fiscal-close", label: "الفترات والإقفال", icon: LockKeyhole, view: "fiscal-close", perm: "screen_fiscal_close" },
      // بند 5 مواءمة PAGE_PERMS: مفتاحان منفصلان كالمكتبي حرفيًا (main_window.py:782-787
      // سندات القبض ← screen_receipts · سندات الصرف ← screen_payments) —
      // بوابة الـAPI تبقى screen_vouchers (الدمج المكتبي الموثق) فلا تغيير بأي حارس مسار
      { id: "vouchers-receipt", label: "سندات القبض", icon: HandCoins, view: "vouchers", mode: "receipt", perm: "screen_receipts" },
      { id: "vouchers-payment", label: "سندات الصرف", icon: Receipt, view: "vouchers", mode: "payment", perm: "screen_payments" },
      { id: "statement", label: "كشف الحساب", icon: FileSpreadsheet, view: "statement", flag: "statement", perm: "screen_statement" },
      { id: "custody", label: "العُهد", icon: Wallet, view: "custody", flag: "custody", perm: "screen_custody" },
      { id: "advances", label: "سلف الموظفين", icon: UsersRound, view: "advances", flag: "custody", perm: "screen_custody" },
      { id: "gateway", label: "بوابة الدفع", icon: CreditCard, view: "gateway", flag: "payment_gateway", perm: "screen_gateway" },
      { id: "other-company", label: "الشركة الأخرى", icon: Building2, view: "other-company", perm: "screen_other_company" },
      { id: "claims", label: "المطالبات المالية", icon: ReceiptText, view: "claims", perm: "screen_claims" },
      { id: "invoices", label: "الفواتير", icon: FileStack, view: "invoices", flag: "invoices", perm: "screen_invoices" },
    ],
    // الجلسة 15 — 16 بندًا ← 6 أقسام (أسوأ حالة أثقل وحدة — تبقى الشريط ثابت العرض)
    top: [
      { id: "t-acc-coa", children: ["chart-of-accounts"] },
      { id: "t-acc-journal", label: "القيود", children: ["journal-entries"] },
      { id: "t-acc-vouchers", label: "السندات", children: ["vouchers-receipt", "vouchers-payment"] },
      { id: "t-acc-ledger", label: "الأستاذ والقوائم", children: ["ledger", "financial-statements", "bank-recon", "zakat-xbrl", "fiscal-close"] },
      { id: "t-acc-custody", label: "العُهد والكشوف", children: ["statement", "custody", "advances", "claims"] },
      { id: "t-acc-billing", label: "الفوترة والبوابة", children: ["invoices", "gateway", "other-company"] },
    ],
  },
  {
    id: "reports",
    label: "التقارير",
    icon: BarChart3,
    /** Task 114: «نظرة عامة» أول بند — كل التقارير مصنفة في شاشة واحدة + القائمة الجانبية بمجموعات */
    children: [
      { id: "reports-home", label: "نظرة عامة", icon: LayoutGrid, view: "reports-home", perm: "screen_reports" },
      ...REPORTS.map((r) => ({
        id: `report-${r.key}`,
        label: r.label,
        icon: r.icon,
        view: "reports" as ViewName,
        report: r.key,
        // المرحلة 3/ب: مفتاح الميزة rep_* لكل تقرير (كالشجرة المكتبية)، والأساس «reports»
        flag: r.flag ?? "reports",
        perm: REPORT_PERM[r.key],
        // Task 114: ترويسة التصنيف في القائمة الجانبية (العملاء والتحصيل/العقود/الخزينة/المحاسبة)
        groupLabel: reportCategory(r.category).label,
      })),
    ],
    // الجلسة 15 — نظرة عامة مباشرة + قائمة واحدة للتقارير الـ11 بفواصل تصنيفاتها (Task 114)
    top: [
      { id: "t-rep-home", children: ["reports-home"] },
      { id: "t-rep-all", label: "التقارير", children: REPORTS.map((r) => `report-${r.key}`) },
    ],
  },
  {
    // القوائم المرجعية — مراجعة التكرار (طلب المالك): «في تكرار المناطق في قائمة مرجعية
    // أخرى بالشكل القديم وكذلك الوظائف والعقود ومراحل العمل» — مصدر واحد لكل كيان:
    //   • الأنواع والمراحل والدفعات: الشاشة الموحدة الثلاثية فقط (حُذف بندا
    //     «أنواع العقود (تفصيلي)» و«مراحل العمل (الشجرة)» القديمان، وحقول النوع
    //     الكاملة انتقلت إلى حوار الشاشة الموحدة).
    //   • المناطق/الوظائف/الأقسام/الإدارات: شاشاتها المخصصة فقط — واستُبعدت من
    //     «القوائم العامة» التي تُبقي الأوزان وقوائم المالك الخاصة («وغيرها»).
    id: "refs",
    label: "القوائم المرجعية",
    icon: BookMarked,
    children: [
      // الشاشة الموحدة — قرار المالك: «أنواع العقود ومراحل العمل والدفعات كلها في صفحة واحدة»
      { id: "ref-tsp", label: "الأنواع والمراحل والدفعات", icon: Layers, view: "ref-lists", section: "types-stages-payments", adminOnly: true },
      // الشاشة الموحدة الثانية — تغيير المالك: «هتكون الوظائف وتاني عمود الادارة وتلت عمود
      // القسم ورابع عمود الوظيفه» — أربعة أعمدة: مكتبة الوظائف ← الإدارة ← القسم ← الوظيفة
      { id: "ref-org", label: "الوظائف والإدارات والأقسام", icon: Network, view: "ref-lists", section: "org-structure", adminOnly: true },
      // الشاشة الموحدة الثالثة — قرار المالك: «المناطق — هتكون المحافظة — المدينة / المنطقة عمود»
      { id: "ref-areas", label: "المناطق", icon: MapPin, view: "ref-lists", section: "areas", adminOnly: true },
      // القوائم العامة — الأوزان والقوائم المخصصة فقط (بلا تكرار للشاشات أعلاه)
      { id: "ref-lists", label: "القوائم العامة", icon: BookMarked, view: "ref-lists", section: "lists", adminOnly: true, perm: "screen_ref_lists" },
    ],
  },
  {
    id: "settings",
    label: "الإعدادات",
    icon: SettingsIcon,
    // الجلسة 14 — قرار المالك «احنا عندنا قواعد للقائمه الجانبيه»: القائمة الجانبية
    // هي الملاحّ الوحيد داخل الإعدادات — شريط التبويبات الأفقي (مرآة المكتبي القديمة
    // settings.py QTabWidget) حُذف من الشاشة، وكل تاب له بند هنا كاملة العدّ:
    // «الشركات» (مطور حصرًا — Task 97) و«النسخ الاحتياطي» (إعداد النسخ الآلي —
    // مرآة settings.py _tab_backup) و«أدوات المطور» (التابات الخمسة settings.py:1020-1242)
    // وشاشة «إدارة البيانات» (سجل التدقيق/النسخ/المحو) بينهما.
    children: [
      { id: "settings-company", label: "بيانات الشركة", icon: SettingsIcon, view: "settings", section: "company", adminOnly: true },
      // Task 97 — قرار معتمد: الشركات للمطور حصرًا (البابان معًا — يستثني المدير والسكرتير)
      { id: "settings-companies", label: "الشركات", icon: Building2, view: "settings", section: "companies", adminOnly: true, developerOnly: true },
      { id: "settings-printing", label: "الطباعة والعرض", icon: FileText, view: "settings", section: "appearance", perm: "screen_settings" },
      { id: "settings-security", label: "الأمان وكلمة المرور", icon: ShieldCheck, view: "settings", section: "security", perm: "screen_settings" },
      { id: "users", label: "المستخدمون والصلاحيات", icon: UserCog, view: "users", adminOnly: true },
      // وثائق جدول الكميات BOQ — انحراف ويب معتمد (قرار المالك 2026-11: الـBOQ في الإعدادات قبل العقد)
      // (أنواع العقود ومراحل العمل في وحدة «القوائم المرجعية» — الجلسة 12 بلا تكرار هنا)
      { id: "boq-docs-config", label: "جدول الكميات BOQ", icon: FileSpreadsheet, view: "settings", section: "boq-docs", adminOnly: true },
      { id: "visits-config", label: "إعدادات الزيارات", icon: CalendarDays, view: "settings", section: "visits", adminOnly: true },
      { id: "posting-rules", label: "قواعد الترحيل", icon: ListChecks, view: "settings", section: "posting-rules", adminOnly: true },
      // إعداد النسخ الاحتياطي الآلي — مرآة settings.py _tab_backup داخل الإعدادات (الجلسة 14)
      { id: "backup", label: "النسخ الاحتياطي", icon: DatabaseBackup, view: "settings", section: "backup", adminOnly: true, flag: "full_backup" },
      // شاشة إدارة البيانات — سجل التدقيق والنسخ والمحو بتاباتها الداخلية (حوكمة النظام)
      { id: "data-mgmt", label: "إدارة البيانات", icon: ScrollText, view: "data-mgmt", section: "backup", adminOnly: true },
      // أدوات المطور — التابات الخمسة الحرفية: المزايا/الهوية/الترحيل/الشبكة/التنظيف (للمطور حصرًا كالمكتبي is_developer — البابان معًا)
      { id: "devtools", label: "أدوات المطور", icon: Wrench, view: "settings", section: "developer", adminOnly: true, developerOnly: true },
    ],
    // الجلسة 15 — 11 بندًا ← 6 أقسام للمدير (7 للمطور: قسم «أدوات المطور» يجفّ عن غيره فيختفي)
    top: [
      { id: "t-set-company", children: ["settings-company"] },
      { id: "t-set-print-sec", label: "الطباعة والأمان", children: ["settings-printing", "settings-security"] },
      { id: "t-set-users", label: "المستخدمون", children: ["users"] },
      { id: "t-set-boq", label: "جدول الكميات BOQ", children: ["boq-docs-config"] },
      { id: "t-set-rules", label: "الزيارات والترحيل", children: ["visits-config", "posting-rules"] },
      { id: "t-set-backup", label: "النسخ والبيانات", children: ["backup", "data-mgmt"] },
      { id: "t-set-dev", label: "أدوات المطور", children: ["settings-companies", "devtools"] },
    ],
  },
];

/** البند النشط الافتراضي لكل وحدة (أول بند مرئي) */
export function firstChildId(
  module: NavModule,
  isAdmin: boolean,
  flagOn: (f: string) => boolean,
  isDeveloper = isAdmin
): string | undefined {
  const visible = module.children.filter(
    (c) =>
      (!c.adminOnly || isAdmin) &&
      (!c.developerOnly || isDeveloper) &&
      (!c.flag || flagOn(c.flag))
  );
  return visible[0]?.id;
}

/** إيجاد الوحدة الحاوية لبند نشط */
export function findNavChild(activeId: string): { module: NavModule; child: NavChild } | null {
  for (const m of NAV_MODULES) {
    const child = m.children.find((c) => c.id === activeId);
    if (child) return { module: m, child };
  }
  return null;
}

// ===== أقسام الشريط العلوي (الجلسة 15 — طراز Odoo) — منطق نقي قابل للاختبار =====

/** قسم الشريط بعد الفلترة: البنود المرئية فقط بترتيب القسم */
export interface TopSectionView {
  section: NavTopSection;
  children: NavChild[];
}

function defaultTopSections(module: NavModule): NavTopSection[] {
  return module.children.map((c) => ({ id: `t-${c.id}`, children: [c.id] }));
}

/**
 * أقسام الشريط العلوي لوحدة — مفلترة بالبنود المرئية (visibleIds):
 * القسم الذي جفّت كل بنوده يختفي كليًا، والقسم المباشر (بند واحد) يصير رابطًا.
 */
export function topSectionsFor(module: NavModule, visibleIds: Set<string>): TopSectionView[] {
  const byId = new Map(module.children.map((c) => [c.id, c] as const));
  const out: TopSectionView[] = [];
  for (const section of module.top ?? defaultTopSections(module)) {
    const kids = section.children
      .map((id) => byId.get(id))
      .filter((c): c is NavChild => !!c && visibleIds.has(c.id));
    if (kids.length === 0) continue;
    out.push({ section, children: kids });
  }
  return out;
}

/** معرّف قسم الشريط العلوي الحاوي للبند النشط — لتمييز القسم النشط في الشريط */
export function topSectionIdForChild(module: NavModule, childId: string): string | undefined {
  return (module.top ?? defaultTopSections(module)).find((s) => s.children.includes(childId))?.id;
}

/**
 * تقسيم بنود قسم واحد إلى مجموعات متتالية وفق ترويسات groupLabel المتسلسلة (التقارير — Task 114):
 * قوائم الشريط بلا ترويسات مجموعات (قرار المواصفة) — ترويسة التصنيف تظهر **فاصلًا** بين المجموعات فقط.
 * البنود بلا groupLabel تصير مجموعة واحدة فلا فواصل (سلوك باقي الوحدات).
 */
export function topSectionItemGroups(children: NavChild[]): NavChild[][] {
  const groups: NavChild[][] = [];
  for (const c of children) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev?.groupLabel === c.groupLabel) last.push(c);
    else groups.push([c]);
  }
  return groups;
}
