// ============================================================
// ConTrack Online — HR-2: طبقة الخادم — البذر المؤجل + قيود المخصصات + تسوية نهاية الخدمة
// (docs/hr-2-design.md §6/§7 — المحرك الموحد postJournalEntry بلا مصدر ثانٍ للأثر المالي)
// ============================================================

import type { Prisma, PrismaClient } from "@prisma/client";
import { postJournalEntry } from "@/lib/journal-server";
import { HR_PROVISION_ACCOUNTS, sumProvisions, type ProvisionEmployee } from "@/lib/hr-provision-core";
import { scheduleMinutesFromPunches, monthEndDate, recountAnnualBalance } from "@/lib/hr-constants";
import { eosServiceYears, computeEos } from "@/lib/hr-eos-core";

type Tx = Prisma.TransactionClient;
type Client = Tx | PrismaClient;

/** حساب احتياطي إجازات الموظفين (2160) — للحساب السنوي المتبقي عند التسوية */
const SALARIES_PAYABLE_CODE = "2160";

/** دليل الشركة يحتوي الكود؟ (للأمان عند فحص البذر) */
async function accountByCode(client: Client, code: string, type: string) {
  return client.account.findFirst({ where: { code, type }, select: { id: true, code: true, name: true } });
}

/**
 * ضمان حسابات HR-2 الثلاثة في دليل الشركة — بذر مؤجل عند أول قيد يحتاجها (G3/G5):
 * 2161 شقيقة 2160 · 2211 شقيقة 2210 · 5211 شقيق 5210 — بنفس الأب (بنية الشجرة تُحترم).
 * يُنشأ الحساب نظاميًا (isSystem) لا يُحذف — والقصور يُبلَّغ برسالة عربية واضحة.
 */
export async function ensureHrAccounts(
  tx: Tx
): Promise<{ leaveProvision: { id: number; name: string }; eosProvision: { id: number; name: string }; eosExpense: { id: number; name: string } }> {
  const [leaveProvision, eosProvision, eosExpense] = await Promise.all([
    accountByCode(tx, HR_PROVISION_ACCOUNTS.leaveProvision.code, HR_PROVISION_ACCOUNTS.leaveProvision.type),
    accountByCode(tx, HR_PROVISION_ACCOUNTS.eosProvision.code, HR_PROVISION_ACCOUNTS.eosProvision.type),
    accountByCode(tx, HR_PROVISION_ACCOUNTS.eosExpense.code, HR_PROVISION_ACCOUNTS.eosExpense.type),
  ]);

  async function ensureOne(
    existing: { id: number; name: string } | null,
    def: { code: string; name: string; type: string; xbrl: string },
    siblingCode: string
  ): Promise<{ id: number; name: string }> {
    if (existing) return existing;
    const sibling = await tx.account.findFirst({ where: { code: siblingCode, type: def.type }, select: { parentId: true } });
    if (!sibling) {
      throw new Error(`حساب «${def.name}» (${def.code}) مطلوب وغير موجود في الدليل — بذِر الدليل القياسي أولًا`);
    }
    const created = await tx.account.create({
      data: {
        code: def.code,
        name: def.name,
        type: def.type,
        nature: def.type === "asset" || def.type === "expense" ? "debit" : "credit",
        parentId: sibling.parentId,
        isLeaf: true,
        allowPosting: true,
        isActive: true,
        isSystem: true,
        notes: "HR-2 — بذر مؤجل عند أول قيد مخصصات (docs/hr-2-design.md §7)",
        xbrlElement: def.xbrl,
      },
    });
    return { id: created.id, name: created.name };
  }

  return {
    leaveProvision: await ensureOne(leaveProvision, HR_PROVISION_ACCOUNTS.leaveProvision, "2160"),
    eosProvision: await ensureOne(eosProvision, HR_PROVISION_ACCOUNTS.eosProvision, "2210"),
    eosExpense: await ensureOne(eosExpense, HR_PROVISION_ACCOUNTS.eosExpense, "5210"),
  };
}

export interface PayrollRecordForProvisions {
  employeeId: number;
  snapPaymentBasis: string;
  baseAmount: Prisma.Decimal | number;
}

export interface EmployeeForProvisions {
  id: number;
  salary: Prisma.Decimal | number;
  hireDate: string;
}

/**
 * قيد المخصصات المصاحب لاعتماد المسير (نفس تاريخه):
 * مدين 5210 (∑ إجازات) + مدين 5211 (∑ نهاية خدمة) / دائن 2161 + دائن 2211.
 * يُتخطى بصمت إن كانت الفئتان صفرًا — يعيد entryId أو null (يُخزن على batch.provisionEntryId).
 * اليوميون مستثنون (تُستقلى مكافأتهم عبر 5211 عند التسوية — حدود موثقة §7).
 */
export async function postPayrollProvisions(
  tx: Tx,
  params: {
    batchId: number;
    month: string; // YYYY-MM
    records: PayrollRecordForProvisions[];
    employees: EmployeeForProvisions[];
    actor: string;
    batchLabel: string;
  }
): Promise<number | null> {
  const monthEnd = monthEndDate(params.month);
  const byId = new Map(params.employees.map((e) => [e.id, e]));
  const inputs: ProvisionEmployee[] = [];
  for (const r of params.records) {
    if (r.snapPaymentBasis !== "monthly") continue; // اليوميون مستثنون
    const emp = byId.get(r.employeeId);
    if (!emp) continue;
    const salary = Number(emp.salary);
    if (salary <= 0) continue;
    inputs.push({ employeeId: r.employeeId, salary, serviceYears: eosServiceYears(emp.hireDate, monthEnd) });
  }
  const totals = sumProvisions(inputs);
  if (totals.leave <= 0 && totals.eos <= 0) return null;

  const acc = await ensureHrAccounts(tx);
  const entryDate = monthEnd;
  const acc5210 = await accountByCode(tx, "5210", "expense");
  if (!acc5210) throw new Error("حساب «رواتب وأجور» (5210) مطلوب لقيد المخصصات وغير موجود في الدليل");
  const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];
  if (totals.leave > 0) {
    lines.push({ accountId: acc5210.id, debit: totals.leave, credit: 0, description: "مصروف مخصص إجازات الشهر" });
    lines.push({ accountId: acc.leaveProvision.id, debit: 0, credit: totals.leave, description: "مخصص إجازات الموظفين" });
  }
  if (totals.eos > 0) {
    lines.push({ accountId: acc.eosExpense.id, debit: totals.eos, credit: 0, description: "مصروف مخصص نهاية الخدمة — الشهر" });
    lines.push({ accountId: acc.eosProvision.id, debit: 0, credit: totals.eos, description: "مخصص نهاية الخدمة" });
  }

  const posted = await postJournalEntry(
    tx,
    {
      entryDate,
      description: `${params.batchLabel} — استحقاق المخصصات الشهري`,
      sourceType: "payroll_provisions",
      sourceId: params.batchId,
      lines,
    },
    params.actor
  );
  return posted.id;
}

export interface EosSettlementInput {
  employeeId: number;
  employeeName: string;
  wage: number; // آخر أجر أساسي (لقطة الموظف)
  hireDate: string;
  endDate: string;
  scenario: string;
  annualLeaveBalance: number; // رصيد السنوي المتبقي لحظة النهاية
  agreementAmount?: number | null;
}

export interface EosSettlementLines {
  eosAmount: number;
  leaveEncashment: number;
  total: number;
}

/**
 * أسطر تسوية نهاية الخدمة (الاستقرار — §7):
 * مدين 2161 (بدل الإجازات حتى رصيد المخصص) + مدين 5210 (الفرق)
 * + مدين 2211 (المكافأة حتى رصيد المخصص) + مدين 5211 (الفرق) / دائن 2160 (الإجمالي).
 * الحسبة نفسها (computeEos) نقيّة — هنا فقط تجميع الأسطر بحرص رصيد الحسابات الدفتري.
 */
export async function buildEosSettlementLines(
  tx: Tx,
  input: EosSettlementInput
): Promise<{ lines: { accountId: number; debit: number; credit: number; description: string }[]; calc: EosSettlementLines & { years: number; fullGratuity: number; capped: boolean; fractionApplied: number } }> {
  const calc = computeEos({
    wage: input.wage,
    hireDate: input.hireDate,
    endDate: input.endDate,
    scenario: input.scenario,
    leaveBalanceDays: input.annualLeaveBalance,
    agreementAmount: input.agreementAmount ?? null,
  });

  const acc = await ensureHrAccounts(tx);
  const acc2160 = await accountByCode(tx, SALARIES_PAYABLE_CODE, "liability");
  if (!acc2160) throw new Error("حساب «رواتب مستحقة» (2160) مطلوب للتسوية وغير موجود في الدليل");
  const acc5210 = await accountByCode(tx, "5210", "expense");
  if (!acc5210) throw new Error("حساب «رواتب وأجور» (5210) مطلوب للتسوية وغير موجود في الدليل");

  // أرصدة المخصصين الدفترية (دائن موجب = رصيد متاح للاستهلاك)
  const leaveBooked = await bookedCreditBalance(tx, acc.leaveProvision.id);
  const eosBooked = await bookedCreditBalance(tx, acc.eosProvision.id);

  const leaveFromProvision = Math.min(calc.leaveEncashment, Math.max(0, leaveBooked));
  const leaveDiff = Math.round((calc.leaveEncashment - leaveFromProvision) * 1000) / 1000;
  const eosFromProvision = Math.min(calc.gratuity, Math.max(0, eosBooked));
  const eosDiff = Math.round((calc.gratuity - eosFromProvision) * 1000) / 1000;

  const lines: { accountId: number; debit: number; credit: number; description: string }[] = [];
  if (calc.leaveEncashment > 0) {
    if (leaveFromProvision > 0) lines.push({ accountId: acc.leaveProvision.id, debit: leaveFromProvision, credit: 0, description: `استهلاك مخصص الإجازات — ${input.employeeName}` });
    if (leaveDiff > 0) lines.push({ accountId: acc5210.id, debit: leaveDiff, credit: 0, description: `فرق بدل الإجازات عن المخصص — ${input.employeeName}` });
  }
  if (calc.gratuity > 0) {
    if (eosFromProvision > 0) lines.push({ accountId: acc.eosProvision.id, debit: eosFromProvision, credit: 0, description: `استهلاك مخصص نهاية الخدمة — ${input.employeeName}` });
    if (eosDiff > 0) lines.push({ accountId: acc.eosExpense.id, debit: eosDiff, credit: 0, description: `فرق مكافأة نهاية الخدمة عن المخصص — ${input.employeeName}` });
  }
  lines.push({ accountId: acc2160.id, debit: 0, credit: calc.total, description: `مستحقات نهاية خدمة — ${input.employeeName}` });

  return {
    lines,
    calc: {
      eosAmount: calc.gratuity,
      leaveEncashment: calc.leaveEncashment,
      total: calc.total,
      years: calc.years,
      fullGratuity: calc.fullGratuity,
      capped: calc.capped,
      fractionApplied: calc.fractionApplied,
    },
  };
}

/** الرصيد الدائني المحسوب لحساب (دائن موجب) — افتتاحي + حركات القيود المنشورة */
async function bookedCreditBalance(tx: Tx, accountId: number): Promise<number> {
  const acc = await tx.account.findUnique({ where: { id: accountId }, select: { openingBalance: true, nature: true } });
  if (!acc) return 0;
  let credit = Number(acc.openingBalance || 0) * (acc.nature === "credit" ? 1 : -1); // دائن موجب بالطبيعة
  const lines = await tx.journalLine.findMany({
    where: { accountId, entry: { status: "posted" } },
    select: { debit: true, credit: true },
  });
  for (const l of lines) credit += Number(l.credit) - Number(l.debit);
  return Math.round(credit * 1000) / 1000;
}

/** رصيد الإجازة السنوي المتبقي لحظة النهاية — نفس النواة المعتمدة (لا تخزين — G9) */
export function leaveBalanceAtEnd(
  employee: { hireDate: string },
  endDate: string,
  approvedDays: number
): { balance: number; probation: boolean } {
  const year = Number(endDate.slice(0, 4));
  const b = recountAnnualBalance({ hireDate: employee.hireDate, year, consumedApprovedDays: approvedDays });
  return { balance: b.balance, probation: b.probation };
}

/** دقائق التأخير/الانصراف من بصمات يدوية مقابل جدول الدوام — بلا جدول صالح ⇒ أصفار (أمان د3-4) */
export async function minutesForCompanyPunches(
  client: Client,
  companyId: number,
  checkIn: string,
  checkOut: string
): Promise<{ lateMinutes: number; earlyLeaveMinutes: number }> {
  const s = await client.setting.findUnique({
    where: { companyId },
    select: { hrWorkStart: true, hrWorkEnd: true, hrGraceMinutes: true },
  });
  if (!s) return { lateMinutes: 0, earlyLeaveMinutes: 0 };
  const m = scheduleMinutesFromPunches(checkIn, checkOut, {
    start: s.hrWorkStart,
    end: s.hrWorkEnd,
    graceMinutes: s.hrGraceMinutes,
  });
  return { lateMinutes: m.late, earlyLeaveMinutes: m.early };
}
