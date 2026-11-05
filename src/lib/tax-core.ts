/**
 * tax-core.ts — نواة الزكاة والضريبة النقية (بلا React ولا server-only) — Task 111.
 * الزكاة 1% (قانون 8/2019 لصندوق الكويت الوطني) + ضريبة دخل الأجانب 15% (شركة أجنبية ملكية حصرًا).
 *
 * قرارات التصميم الموثقة:
 *  • مصدر الرقم الوحيد الأستاذ: صافي ربح السنة من حركة 4xxx/5xxx المرحّلة داخل السنة —
 *    قيود الإغلاق السنوي (sourceType=closing) مستثناة حتى لا تصير النتيجة صفرًا بعد الإقفال.
 *  • تعديلات «النموذج المعلن» يوثقها المستخدم صفًا صفًا (إضافة موجبة/خصم سالب) —
 *    النواة تتحقق منها ولا تُخترع أرقامًا.
 *  • الوعاء = صافي الربح + التعديلات؛ للزكاة لا يقل عن صفر (خسارة لا تولد زكاة).
 *  • الضريبة 15% على الشركات الأجنبية الملكية فقط (علم foreignOwned على الشركة) —
 *    نفس الحسبة بنسبة مختلفة وعلى الوعاء نفسه (موثق أن تعديلها الإداري من النموذج).
 *  • الاعتماد = قيد مخصص آلي عبر المحرك الموحد: زكاة (5400 مدين / 2170 دائن)،
 *    ضريبة (5300 مدين / 2180 دائن) — حسابات نظامية معروفة بالكود مع fallback XBRL.
 *  • الإلغاء بعد الاعتماد = قيد عكسي موثق عبر cancelJournalEntry — بلا حذف فيزيائي.
 */

import { r3 } from "./accounting-journal";

export const ZAKAT_RATE = 0.01;
export const FOREIGN_TAX_RATE = 0.15;

export type TaxKind = "zakat" | "foreign_tax";

export const TAX_KIND_LABEL: Record<TaxKind, string> = {
  zakat: "الزكاة 1% — صندوق الكويت الوطني (قانون 8/2019)",
  foreign_tax: "ضريبة دخل الأجانب 15% — الشركات الأجنبية الملكية",
};

export const TAX_DECL_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  approved: "معتمد (المخصص قيدًا)",
  cancelled: "ملغى",
};

/** حسابات قيد المخصص — تحسم بالكود أولًا ثم خريطة XBRL fallback (حسم الخادم) */
export const TAX_ACCOUNT_PINS: Record<TaxKind, { debitCode: string; creditCode: string; debitXbrl: string; creditXbrl: string; label: string }> = {
  zakat: {
    debitCode: "5400",
    creditCode: "2170",
    debitXbrl: "kw:ZakatExpense",
    creditXbrl: "kw:ZakatPayable",
    label: "مخصص الزكاة السنوية",
  },
  foreign_tax: {
    debitCode: "5300",
    creditCode: "2180",
    debitXbrl: "kw:OtherExpenses",
    creditXbrl: "kw:IncomeTaxPayable",
    label: "مخصص ضريبة دخل الأجانب",
  },
};

// ==================== تعديلات النموذج المعلن ====================

export interface TaxAdjustment {
  label: string;
  /** موجب = إضافة للوعاء، سالب = خصم منه */
  amount: number;
}

/** قالب النموذج المعلن — التسميات الشائعة بأصفار يملؤها المستخدم (وثق لا اختراع) */
export const DEFAULT_ZAKAT_ADJUSTMENTS: TaxAdjustment[] = [
  { label: "إهلاك معاد إضافته", amount: 0 },
  { label: "مخصصات وأحكام غير محققة", amount: 0 },
  { label: "خسائر محققة خلال السنة", amount: 0 },
  { label: "أرباح من مصادر خارج الكويت (خصم)", amount: 0 },
];

export function validateAdjustments(list: unknown): { ok: boolean; error?: string; clean: TaxAdjustment[]; total: number } {
  if (list === undefined || list === null) return { ok: true, clean: [], total: 0 };
  if (!Array.isArray(list)) return { ok: false, error: "التعديلات يجب أن تكون قائمة.", clean: [], total: 0 };
  const clean: TaxAdjustment[] = [];
  let total = 0;
  for (const item of list) {
    const it = item as Partial<TaxAdjustment>;
    const label = String(it?.label ?? "").trim();
    const amount = Number(it?.amount);
    if (!label) return { ok: false, error: "كل تعديل يحتاج وصفًا.", clean: [], total: 0 };
    if (!Number.isFinite(amount)) return { ok: false, error: `مبلغ التعديل «${label}» غير صالح.`, clean: [], total: 0 };
    const r = r3(amount);
    if (r === 0) continue; // صف صفر يُتجاهل (قالب لم يُملأ)
    clean.push({ label, amount: r });
    total = r3(total + r);
  }
  return { ok: true, clean, total };
}

// ==================== الحسبة ====================

export interface TaxComputation {
  netProfit: number; // من الأستاذ (موجب = ربح / سالب = خسارة)
  adjustmentsTotal: number;
  base: number; // الوعاء
  rate: number;
  amount: number; // المخصص
}

export function computeTax(kind: TaxKind, netProfit: number, adjustments: TaxAdjustment[]): TaxComputation {
  const adj = r3(adjustments.reduce((s, a) => s + a.amount, 0));
  let base = r3(netProfit + adj);
  if (kind === "zakat" && base < 0) base = 0; // خسارة لا تولد زكاة
  const rate = kind === "zakat" ? ZAKAT_RATE : FOREIGN_TAX_RATE;
  const amount = r3(base * rate);
  return { netProfit: r3(netProfit), adjustmentsTotal: adj, base, rate, amount };
}

/** تحقق جاهزية الاعتماد — كل شروط النشر في مكانها */
export function validateForApproval(input: {
  status: string;
  kind: TaxKind;
  year: number;
  netProfit: number;
  base: number;
  amount: number;
  foreignOwned?: boolean;
  hasApprovedSameYear?: boolean;
}): { ok: boolean; error?: string } {
  if (input.status !== "draft") return { ok: false, error: "الاعتماد للمسودات حصرًا." };
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) return { ok: false, error: "سنة الإقرار غير صالحة." };
  if (input.hasApprovedSameYear) return { ok: false, error: `سنة ${input.year} عليها إقرار معتمد بالفعل — الإلغاء أولًا إن احتجت إعادة الاحتساب.` };
  if (input.kind === "foreign_tax" && !input.foreignOwned) {
    return { ok: false, error: "ضريبة دخل الأجانب للشركات الأجنبية الملكية حصرًا — فعّل العلم من إعدادات الشركة." };
  }
  if (input.amount <= 0) return { ok: false, error: "المخصص صفر — لا قيد على صفر (راجع الوعاء والتعديلات)." };
  return { ok: true };
}

/** وصف قيد المخصص الموحد */
export function provisionEntryDescription(kind: TaxKind, year: number): string {
  return `${TAX_KIND_LABEL[kind]} — قيد المخصص لسنة ${year}`;
}

// ==================== عرض المسودة ====================

export interface TaxDeclarationDTO {
  id: number;
  year: number;
  kind: TaxKind;
  status: string;
  netProfit: number;
  adjustments: TaxAdjustment[];
  base: number;
  rate: number;
  amount: number;
  entryNo: number | null;
  entryId: number | null;
  notes: string;
  approvedBy: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  createdAt: string;
}
