"use client";

import * as React from "react";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileStack,
  FileText,
  HandCoins,
  HardHat,
  LayoutDashboard,
  ListTodo,
  MessageSquareText,
  Receipt,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  UserCog,
  Users as UsersIcon,
  UsersRound,
  Wallet,
  Wrench,
} from "lucide-react";

import type { ViewName } from "./contrack-types";
import { REPORTS } from "./reports-list";

/** معرّف الوحدات المعتمدة (توجيه المستخدم — تبويبات علوية) */
export type ModuleId = "clients" | "subs" | "accounting" | "reports" | "settings";

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
}

export interface NavModule {
  id: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavChild[];
}

/**
 * هيكل التنقل المعتمد (5 تبويبات — توجيه المستخدم 2026-10-19: مركز التقارير تاب علوي):
 *   1. العقود: اللوحة، المستحقات، العملاء، العقود، المهام، الزيارات، التعليقات، المتابعة
 *   2. الباطن: مقاولو الباطن (ملف المقاول: العقود والدفعات والأوامر)
 *   3. المحاسبة: سندات القبض/الصرف، كشف الحساب، العُهد، السلف، البوابة، الشركة الأخرى، المطالبات، الفواتير
 *   4. التقارير: التقارير الـ11 بنودًا حقيقية في القائمة الجانبية الرسمية كالمحاسبة (توجيه المستخدم — الخيار 2)
 *   5. الإعدادات: الشركة، الطباعة، الأمان، المستخدمون، الأنواع، المصروفات، المراحل، الزيارات، النسخ، أدوات المطور
 * خارج النطاق (لا يُضاف): مركز النماذج، المشاريع، عروض الأسعار، مجموعات العقود، الأرشيف، الواتساب، الاستيراد من Excel.
 */
export const NAV_MODULES: NavModule[] = [
  {
    id: "clients",
    label: "العقود",
    icon: FileText,
    children: [
      { id: "dashboard", label: "اللوحة", icon: LayoutDashboard, view: "dashboard" },
      { id: "due", label: "المهام المستحقة", icon: CalendarClock, view: "due" },
      { id: "customers", label: "العملاء", icon: UsersIcon, view: "customers" },
      { id: "contracts", label: "العقود", icon: FileText, view: "contracts" },
      { id: "tasks", label: "المهام", icon: ListTodo, view: "tasks", flag: "tasks" },
      { id: "visits", label: "جدول الزيارات", icon: CalendarDays, view: "visits", flag: "visits" },
      { id: "comments", label: "التعليقات", icon: MessageSquareText, view: "comments", flag: "comments" },
      { id: "followup", label: "المتابعة", icon: ClipboardList, view: "followup", flag: "followup" },
    ],
  },
  {
    id: "subs",
    label: "الباطن",
    icon: HardHat,
    children: [
      { id: "subcontractors", label: "مقاولو الباطن", icon: HardHat, view: "subcontractors", flag: "subcontractors" },
    ],
  },
  {
    id: "accounting",
    label: "المحاسبة",
    icon: Wallet,
    children: [
      { id: "vouchers-receipt", label: "سندات القبض", icon: HandCoins, view: "vouchers", mode: "receipt" },
      { id: "vouchers-payment", label: "سندات الصرف", icon: Receipt, view: "vouchers", mode: "payment" },
      { id: "statement", label: "كشف الحساب", icon: FileSpreadsheet, view: "statement", flag: "statement" },
      { id: "custody", label: "العُهد", icon: Wallet, view: "custody", flag: "custody" },
      { id: "advances", label: "سلف الموظفين", icon: UsersRound, view: "advances", flag: "custody" },
      { id: "gateway", label: "بوابة الدفع", icon: CreditCard, view: "gateway", flag: "payment_gateway" },
      { id: "other-company", label: "الشركة الأخرى", icon: Building2, view: "other-company" },
      { id: "claims", label: "المطالبات المالية", icon: ReceiptText, view: "claims" },
      { id: "invoices", label: "الفواتير", icon: FileStack, view: "invoices", flag: "invoices" },
    ],
  },
  {
    id: "reports",
    label: "التقارير",
    icon: BarChart3,
    /** التقارير الـ11 بنودًا حقيقية — القائمة الجانبية الرسمية كالمحاسبة (توجيه المستخدم — الخيار 2) */
    children: REPORTS.map((r) => ({
      id: `report-${r.key}`,
      label: r.label,
      icon: r.icon,
      view: "reports" as ViewName,
      report: r.key,
      flag: "reports",
    })),
  },
  {
    id: "settings",
    label: "الإعدادات",
    icon: SettingsIcon,
    children: [
      { id: "settings-company", label: "بيانات الشركة", icon: SettingsIcon, view: "settings", section: "company", adminOnly: true },
      { id: "settings-printing", label: "الطباعة والعرض", icon: FileText, view: "settings", section: "appearance" },
      { id: "settings-security", label: "الأمان وكلمة المرور", icon: ShieldCheck, view: "settings", section: "security" },
      { id: "users", label: "المستخدمون والصلاحيات", icon: UserCog, view: "users", adminOnly: true },
      { id: "contract-types", label: "أنواع العقود", icon: FileStack, view: "settings", section: "contract-types", adminOnly: true },
      { id: "expense-accounts", label: "حسابات المصروفات", icon: Wallet, view: "settings", section: "expense-accounts", adminOnly: true },
      { id: "workflow-stages", label: "مراحل المتابعة", icon: ClipboardList, view: "settings", section: "workflow", adminOnly: true },
      { id: "visits-config", label: "جدول الزيارات", icon: CalendarDays, view: "settings", section: "visits", adminOnly: true },
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
