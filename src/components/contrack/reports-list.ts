"use client";

/**
 * المصدر الموحد لقائمة التقارير — يستخدمه:
 *   nav-structure.ts  ⇒ بنود القائمة الجانبية الرسمية لوحدة التقارير
 *   ReportsHomeView.tsx ⇒ شاشة «نظرة عامة» المصنفة (بطاقة لكل تقرير/شاشة)
 *   ReportsView.tsx   ⇒ تعريفات الفلاتر والاستعلام + منسدلة الجوال المصنفة
 *   AppShell.tsx      ⇒ غير مباشر (عبر بنود nav)
 * (توجيه المستخدم 2026-10-19 — الخيار 2: قائمة التقارير قائمة جانبية رسمية كالمحاسبة)
 * (تنظيم المركز — Task 114: تصنيف التقارير الأربع + ربط شاشات الدفاتر المحاسبية
 *  في المكان نفسه بدل تشتتها بين تبويبي التقارير والمحاسبة)
 */
import * as React from "react";
import {
  ArrowLeftRight,
  Banknote,
  BookOpenText,
  FileBadge,
  FileSpreadsheet,
  FileText,
  Gauge,
  HardHat,
  Landmark,
  Layers,
  Receipt,
  Scale,
  Target,
  Timer,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";

export interface ReportOption {
  value: string;
  label: string;
}

/** تصنيفات مركز التقارير — كل تقرير ينتمي لتصنيف واحد (الترتيب هو ترتيب العرض) */
export type ReportCategoryId = "clients" | "ops" | "treasury" | "accounting";

export interface ReportCategory {
  id: ReportCategoryId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    id: "clients",
    label: "العملاء والتحصيل",
    desc: "أرصدة العملاء ومستحقاتهم وفرص البيع",
    icon: UsersIcon,
  },
  {
    id: "ops",
    label: "العقود والتنفيذ",
    desc: "أداء العقود ومراحلها وتأخيراتها",
    icon: FileText,
  },
  {
    id: "treasury",
    label: "الخزينة والمصروفات",
    desc: "الوارد والمنصرف وحركة النقد",
    icon: Wallet,
  },
  {
    id: "accounting",
    label: "المحاسبة والدفاتر",
    desc: "اليومية والأستاذ والقوائم والتسوية",
    icon: BookOpenText,
  },
];

export function reportCategory(id: ReportCategoryId): ReportCategory {
  return REPORT_CATEGORIES.find((c) => c.id === id) ?? REPORT_CATEGORIES[0];
}

export interface ReportDef {
  key: string; // مفتاح المسار /api/reports/{key}
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  /** تصنيف المركز — يجمع التقارير المتشابهة في مجموعة واحدة */
  category: ReportCategoryId;
  period?: boolean; // from/to
  selectParam?: string; // اسم باراميتر القائمة المنسدلة
  selectLabel?: string;
  options?: ReportOption[]; // أول خيار = «الكل» (قيمة فارغة لا تُرسل)
  /**
   * مفتاح الميزة rep_* (المرحلة 3/ب — مطابقة المكتبي feature_service):
   * تعطيله يخفي التقرير من القائمة ويوقفه خادميًا (report-features.ts).
   * «تفصيل المصروفات» لا مفتاحًا مكتبيًا لها — بلا بوابة ميزة (موثق).
   */
  flag?: string;
}

export const REPORTS: ReportDef[] = [
  {
    key: "customers-balances",
    label: "العملاء والأرصدة",
    icon: UsersIcon,
    desc: "أرصدة العملاء والمحصّل والمستحق الآن",
    category: "clients",
    period: true,
    flag: "rep_customers",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "with_balance", label: "من عليهم أرصدة" },
      { value: "no_balance", label: "بلا أرصدة" },
      { value: "due_only", label: "المستحق الآن فقط" },
      { value: "by_stages", label: "بالمراحل" },
    ],
  },
  {
    key: "stage-dues",
    label: "مستحقات المراحل",
    icon: Layers,
    desc: "المستحق لكل مرحلة بحالاتها الصارمة",
    category: "clients",
    flag: "rep_dues_board",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "due_only", label: "المستحق الآن" },
      { value: "overdue_only", label: "المتأخر فقط" },
    ],
  },
  {
    key: "leads",
    label: "الفرص البيعية",
    icon: Target,
    desc: "العملاء المسجلون بلا أي عقد بعد · فرصك البيعية القادمة للتواصل والمتابعة",
    category: "clients",
    period: true,
    flag: "rep_leads",
  },
  {
    key: "contracts",
    label: "تقارير العقود",
    icon: FileText,
    desc: "نظرة شاملة وربحية وانتهاء",
    category: "ops",
    period: true,
    flag: "rep_contracts",
    selectParam: "option",
    selectLabel: "الخيار",
    options: [
      { value: "", label: "كل العقود" },
      { value: "profitability", label: "الربحية الفعلية" },
      { value: "profit_by_type", label: "الربحية حسب النوع" },
      { value: "by_type", label: "حسب نوع العقد" },
      { value: "expiring", label: "العقود المنتهية قريبًا" },
    ],
  },
  {
    key: "execution",
    label: "مراحل التنفيذ",
    icon: Gauge,
    desc: "الإشغال الزمني للمراحل الجارية",
    category: "ops",
    flag: "rep_execution",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "", label: "الكل" },
      { value: "current", label: "الجارية" },
      { value: "delayed", label: "المتأخرة" },
      { value: "near", label: "قاربت الانتهاء" },
      { value: "ok", label: "ضمن الوقت" },
      { value: "no_stage", label: "بلا مراحل" },
    ],
  },
  {
    key: "supervision-delays",
    label: "تأخير الإشراف",
    icon: Timer,
    desc: "شهور وأيام وأموال التأخير الإشرافي",
    category: "ops",
    flag: "rep_supervision_delay",
    selectParam: "option",
    selectLabel: "العرض",
    options: [
      { value: "unpaid", label: "غير المسددة (افتراضي)" },
      { value: "all", label: "الكل" },
    ],
  },
  {
    key: "subcontractors",
    label: "المقاولون",
    icon: HardHat,
    desc: "تقرير مقاولي الباطن الشامل بالدفعات",
    category: "ops",
    flag: "rep_subcontractors",
  },
  {
    key: "vouchers",
    label: "الإيرادات والمصروفات",
    icon: Receipt,
    desc: "سندات الفترة مقسمة إيرادًا ومصروفًا",
    category: "treasury",
    period: true,
    flag: "rep_vouchers",
    selectParam: "vtype",
    selectLabel: "نوع السند",
    options: [
      { value: "", label: "الكل" },
      { value: "receipt", label: "قبض" },
      { value: "payment", label: "صرف" },
      { value: "custody_return", label: "إرجاع عهدة" },
      { value: "salary_deduction", label: "خصم راتب" },
    ],
  },
  {
    key: "expenses",
    label: "تفصيل المصروفات",
    icon: Wallet,
    desc: "المصروفات بتفصيل حساباتها",
    category: "treasury",
    period: true,
  },
  {
    key: "cashflow",
    label: "التدفق النقدي",
    icon: Banknote,
    desc: "الوارد والمنصرف وصافي الحركة",
    category: "treasury",
    period: true,
    flag: "rep_cashflow",
    selectParam: "mode",
    selectLabel: "العرض",
    options: [
      { value: "detail", label: "تفصيلي" },
      { value: "summary", label: "ملخص" },
      { value: "receipts_only", label: "وارد فقط" },
      { value: "payments_only", label: "منصرف فقط" },
      { value: "recoveries_only", label: "مسترد فقط" },
      { value: "transfers_only", label: "تحويلات فقط" },
      { value: "daily", label: "يومي" },
      { value: "monthly", label: "شهري" },
      { value: "yearly", label: "سنوي" },
    ],
  },
  {
    key: "journal",
    label: "دفتر اليومية",
    icon: BookOpenText,
    desc: "قيود اليومية المزدوجة",
    category: "accounting",
    period: true,
    flag: "rep_journal",
  },
];

/**
 * شاشات التقارير المحاسبية — كانت مشتتة بين تبويب المحاسبة وتبويب التقارير،
 * والآن كلٌّ منها بطاقة في تصنيفها داخل «نظرة عامة» (توجيه Task 114).
 * الفتح عبر التنقل الرسمي مع باب صلاحية الشاشة نفسه (canOpenView).
 */
export interface ReportScreenLink {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
  view: string; // ViewName — نص لتجنب الاستيراد الدوري (nav-perms يملك الباب)
  perm: string; // باب الصلاحية screen_*
  category: ReportCategoryId;
}

export const REPORT_SCREEN_LINKS: ReportScreenLink[] = [
  {
    id: "link-statement",
    label: "كشف الحساب",
    icon: FileSpreadsheet,
    desc: "كشف حركة عميل أو عقد أو مقاول بالطباعة والـPDF",
    view: "statement",
    perm: "screen_statement",
    category: "clients",
  },
  {
    id: "link-ledger",
    label: "دفتر الأستاذ والميزان",
    icon: Scale,
    desc: "الأستاذ العام وميزان المراجعة وأعمار الذمم",
    view: "ledger",
    perm: "screen_ledger",
    category: "accounting",
  },
  {
    id: "link-financial-statements",
    label: "القوائم المالية",
    icon: Landmark,
    desc: "قائمة المركز والدخل والتدفقات (44/2016) بفحوص التوازن",
    view: "financial-statements",
    perm: "screen_financial_statements",
    category: "accounting",
  },
  {
    id: "link-bank-recon",
    label: "التسوية البنكية",
    icon: ArrowLeftRight,
    desc: "مطابقة كشف البنك مع الأستاذ + تقرير الفوارق",
    view: "bank-recon",
    perm: "screen_bank_recon",
    category: "accounting",
  },
  {
    id: "link-zakat-xbrl",
    label: "الزكاة والتقديم",
    icon: FileBadge,
    desc: "إقرار الزكاة 1% والضريبة 15% ومصدّر iXBRL",
    view: "zakat-xbrl",
    perm: "screen_zakat_xbrl",
    category: "accounting",
  },
];

/** التقرير الافتراضي عند فتح تقرير من المركز */
export const DEFAULT_REPORT_KEY = REPORTS[0].key;

/** التقارير المرئية فقط حسب مزاياها rep_* (المرحلة 3/ب) — القائمة والمنسدلة والافتراضي */
export function visibleReports(flagOn: (key: string) => boolean): ReportDef[] {
  return REPORTS.filter((r) => !r.flag || flagOn(r.flag));
}

/** مجموعة تصنيف واحد: تقاريره المرئية (فلاتر الميزة تُمرر من المزوّد) */
export function reportsByCategory(
  category: ReportCategoryId,
  flagOn: (key: string) => boolean
): ReportDef[] {
  return visibleReports(flagOn).filter((r) => r.category === category);
}

/** روابط الشاشات المرئية لتصنيف ما حسب الصلاحية (الدور يحسمها permAllows) */
export function screenLinksByCategory(
  category: ReportCategoryId,
  permOn: (key: string) => boolean
): ReportScreenLink[] {
  return REPORT_SCREEN_LINKS.filter((l) => l.category === category && permOn(l.perm));
}
