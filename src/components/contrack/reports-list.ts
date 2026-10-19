"use client";

/**
 * المصدر الموحد لقائمة التقارير — يستخدمه:
 *   nav-structure.ts  ⇒ بنود القائمة الجانبية الرسمية لوحدة التقارير
 *   ReportsView.tsx   ⇒ تعريفات الفلاتر والاستعلام
 *   AppShell.tsx      ⇒ غير مباشر (عبر بنود nav)
 * (توجيه المستخدم 2026-10-19 — الخيار 2: قائمة التقارير قائمة جانبية رسمية كالمحاسبة)
 */
import * as React from "react";
import {
  Banknote,
  BookOpenText,
  FileText,
  Gauge,
  HardHat,
  Layers,
  Receipt,
  Target,
  Timer,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";

export interface ReportOption {
  value: string;
  label: string;
}

export interface ReportDef {
  key: string; // مفتاح المسار /api/reports/{key}
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
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
    key: "supervision-delays",
    label: "تأخير الإشراف",
    icon: Timer,
    desc: "شهور وأيام وأموال التأخير الإشرافي",
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
    flag: "rep_subcontractors",
  },
  {
    key: "vouchers",
    label: "الإيرادات والمصروفات",
    icon: Receipt,
    desc: "سندات الفترة مقسمة إيرادًا ومصروفًا",
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
    period: true,
  },
  {
    key: "cashflow",
    label: "التدفق النقدي",
    icon: Banknote,
    desc: "الوارد والمنصرف وصافي الحركة",
    period: true,
    flag: "rep_cashflow",
    selectParam: "mode",
    selectLabel: "العرض",
    options: [
      { value: "detail", label: "تفصيلي" },
      { value: "summary", label: "ملخص" },
      { value: "daily", label: "يومي" },
      { value: "monthly", label: "شهري" },
      { value: "yearly", label: "سنوي" },
    ],
  },
  {
    key: "contracts",
    label: "تقارير العقود",
    icon: FileText,
    desc: "نظرة شاملة وربحية وانتهاء",
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
    key: "leads",
    label: "الفرص البيعية",
    icon: Target,
    desc: "العملاء المسجلون بلا أي عقد بعد · فرصك البيعية القادمة للتواصل والمتابعة",
    period: true,
    flag: "rep_leads",
  },
  {
    key: "journal",
    label: "دفتر اليومية",
    icon: BookOpenText,
    desc: "قيود اليومية المزدوجة",
    period: true,
    flag: "rep_journal",
  },
];

/** التقرير الافتراضي عند فتح تاب التقارير */
export const DEFAULT_REPORT_KEY = REPORTS[0].key;

/** التقارير المرئية فقط حسب مزاياها rep_* (المرحلة 3/ب) — القائمة والمنسدلة والافتراضي */
export function visibleReports(flagOn: (key: string) => boolean): ReportDef[] {
  return REPORTS.filter((r) => !r.flag || flagOn(r.flag));
}
