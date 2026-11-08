// ============================================================
// ConTrack Online — HR-2: نواة محرك المخصصات النقية (bun test فقط)
// استحقاق شهري يُقيَّد مع اعتماد المسير (docs/hr-2-design.md §7):
// • مخصص الإجازات: 2.5 يوم × (الأساسي ÷ 26) — د1 — مدين 5210 / دائن 2161
// • مخصص نهاية الخدمة: (نصف شهر إن الخدمة <5 سنوات · شهر كامل إن ≥5) ÷ 12 — مدين 5211 / دائن 2211
// المخصص تجميعي بمستوى الشركة (د5) — واليوميون مستثنون (تُستقلى مكافأتهم عبر 5211 عند التسوية).
// ============================================================

import { r3, LEAVE_DAY_DIVISOR } from "./hr-constants";

export const PROVISION_LEAVE_ACCRUAL_DAYS = 2.5; // م70 — 30 يومًا ÷ 12 شهرًا

/** دبابيس حسابات المخصصات — تُضمن آليًا عند أول قيد (ensureHrAccounts — G3/G5) */
export const HR_PROVISION_ACCOUNTS = {
  leaveProvision: { code: "2161", name: "مخصص إجازات الموظفين", type: "liability", xbrl: "ifrs-full:LiabilitiesForEmployeeBenefits" },
  eosProvision: { code: "2211", name: "مخصص نهاية الخدمة", type: "liability", xbrl: "kw:EndOfServiceProvision" },
  eosExpense: { code: "5211", name: "مصروف مخصص نهاية الخدمة", type: "expense", xbrl: "ifrs-full:EmployeeBenefitsExpense" },
} as const;

/** الاستحقاق الشهري لمخصص الإجازات لموظف شهري */
export function leaveProvisionMonthly(salary: number): number {
  return r3(PROVISION_LEAVE_ACCRUAL_DAYS * (Math.max(0, salary || 0) / LEAVE_DAY_DIVISOR));
}

/**
 * الاستحقاق الشهري لمخصص نهاية الخدمة لموظف شهري:
 * معدل سنة الخدمة الحالية (نصف شهري للخمس الأولى · شهري كامل بعدها) ÷ 12.
 * لا سقف أثناء التراكم — السقف (18 شهرًا) يُطبق عند حساب التسوية (§6) والفرق يصرف مصروفًا.
 */
export function eosProvisionMonthly(salary: number, serviceYears: number): number {
  const rate = serviceYears < 5 ? 0.5 : 1.0;
  return r3((rate * Math.max(0, salary || 0)) / 12);
}

export interface ProvisionEmployee {
  employeeId: number;
  salary: number; // الأساسي الشهري — اليوميون مستثنون قبل النداء
  serviceYears: number; // حتى نهاية شهر المسير (eosServiceYears بالسيرفر)
}

export interface ProvisionsTotals {
  leave: number;
  eos: number;
  count: number; // عدد الموظفين المشاركين
}

/** تجميع المخصصات الشهرية لقيد الاعتماد — لا قيد إن كانت الفئة صفرًا (يفحص الخادم) */
export function sumProvisions(employees: ProvisionEmployee[]): ProvisionsTotals {
  let leave = 0;
  let eos = 0;
  let count = 0;
  for (const e of employees) {
    const s = Math.max(0, e.salary || 0);
    if (s <= 0) continue; // بلا راتب معرف = مستثنى من المسير أصلًا
    leave += leaveProvisionMonthly(s);
    eos += eosProvisionMonthly(s, e.serviceYears);
    count++;
  }
  return { leave: r3(leave), eos: r3(eos), count };
}
