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
  /** مفتاح الميزة (feature_flags) الذي يخفي البند عند تعطيله — كالشجرة المكتبية */
  flag?: string;
  /** مفتاح الصلاحية (المواءمة المكتبية) الذي يخفي البند عن من لا يملكه — المرحلة 2/ب */
  perm?: string;
  /** ترويسة مجموعة داخل القائمة الجانبية — تُعرض قبل البند أول مرة يتغير فيها (Task 114) */
  groupLabel?: string;
}

export interface NavModule {
  id: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavChild[];
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
 *   7. الإعدادات: الشركة، الطباعة، الأمان، المستخدمون، الأنواع، المصروفات، المراحل، الزيارات، النسخ، أدوات المطور
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
      { id: "contract-groups", label: "مجموعات العقود", icon: Layers, view: "contract-groups", perm: "screen_customers" },
      // بند 56: موضع المكتبي بند شل مشروط بمفتاح المزايا «forms_center» وصلاحية
      // screen_forms معًا (main_window.py:812-814) — والبند تحت وحدة العقود كشاشة العمل
      { id: "forms", label: "مركز النماذج", icon: LayoutTemplate, view: "forms", flag: "forms_center", perm: "screen_forms" },
      { id: "tasks", label: "المهام", icon: ListTodo, view: "tasks", flag: "tasks", perm: "screen_tasks" },
      { id: "visits", label: "جدول الزيارات", icon: CalendarDays, view: "visits", flag: "visits", perm: "screen_visits" },
      { id: "comments", label: "التعليقات", icon: MessageSquareText, view: "comments", flag: "comments", perm: "screen_customers" },
      { id: "followup", label: "المتابعة", icon: ClipboardList, view: "followup", flag: "followup", perm: "screen_followup" },
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
  },
  {
    id: "settings",
    label: "الإعدادات",
    icon: SettingsIcon,
    children: [
      { id: "settings-company", label: "بيانات الشركة", icon: SettingsIcon, view: "settings", section: "company", adminOnly: true },
      { id: "settings-printing", label: "الطباعة والعرض", icon: FileText, view: "settings", section: "appearance", perm: "screen_settings" },
      { id: "settings-security", label: "الأمان وكلمة المرور", icon: ShieldCheck, view: "settings", section: "security", perm: "screen_settings" },
      { id: "users", label: "المستخدمون والصلاحيات", icon: UserCog, view: "users", adminOnly: true },
      { id: "contract-types", label: "أنواع العقود", icon: FileStack, view: "settings", section: "contract-types", adminOnly: true },
      { id: "workflow-stages", label: "مراحل المتابعة", icon: ClipboardList, view: "settings", section: "workflow", adminOnly: true },
      { id: "visits-config", label: "إعدادات الزيارات", icon: CalendarDays, view: "settings", section: "visits", adminOnly: true },
      { id: "posting-rules", label: "قواعد الترحيل", icon: ListChecks, view: "settings", section: "posting-rules", adminOnly: true },
      { id: "backup", label: "النسخ الاحتياطي", icon: FileSpreadsheet, view: "data-mgmt", section: "backup", adminOnly: true, flag: "full_backup" },
      { id: "devtools", label: "أدوات المطور", icon: Wrench, view: "data-mgmt", section: "devtools", adminOnly: true },
    ],
  },
];

/** البند النشط الافتراضي لكل وحدة (أول بند مرئي) */
export function firstChildId(module: NavModule, isAdmin: boolean, flagOn: (f: string) => boolean): string | undefined {
  const visible = module.children.filter(
    (c) => (!c.adminOnly || isAdmin) && (!c.flag || flagOn(c.flag))
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
