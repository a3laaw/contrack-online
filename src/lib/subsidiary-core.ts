/**
 * subsidiary-core.ts — نواة «الذمم الفرعية الآلية لكل عقد + WIP» النقية
 * (بلا React ولا server-only) — البند الثالث من خريطة NOVA.
 * docs/subsidiary-wip-design.md: الحسابات الفرعية صفوف Account حقيقية بأكواد
 * حتمية مشتقة من رقم العقد — بلا جدول جديد ولا عمود جديد (بلا تسجيلات T111).
 *
 * قرار الجسر: الحساب الأب (1121 العملاء) يبقى ورقة قابلة للنشر بلا أي لمس —
 * الفرعية تنشأ تحته وتستقبل ترحيلات الجسرين فقط (إصدار الفاتورة/سداد التخصيصات).
 */

// ==================== الثوابت ====================

/** الحساب الأب لذمم العملاء — من بذرة الدليل الكويتي (Task 102) */
export const AR_PARENT_CODE = "1121";

/** حساب التحكم الجديد للأعمال تحت التنفيذ — ابن 1120 في البذرة */
export const WIP_CONTROL_CODE = "1125";
export const WIP_CONTROL_NAME = "أعمال تحت التنفيذ (WIP)";

export const WIP_CONTROL_NOTES =
  "حساب التحكم بأعمال تحت التنفيذ — الحسابات الفرعية الآلية لكل عقد تُنشأ تحته (docs/subsidiary-wip-design.md)";

/** أقل عرض لرقم العقد داخل كود الفرعي — يتوسع تلقائيًا فوق 9999 عقد */
const PAD = 4;

export type SubsidiaryKind = "ar" | "wip";

export const SUBSIDIARY_KIND_LABEL: Record<SubsidiaryKind, string> = {
  ar: "ذمم عقد",
  wip: "أعمال تحت التنفيذ",
};

/** كود الحساب الفرعي الحتمي للعقد — 1121 + pad4(id) / 1125 + pad4(id) */
export function subsidiaryCode(kind: SubsidiaryKind, contractId: number): string {
  const parent = kind === "ar" ? AR_PARENT_CODE : WIP_CONTROL_CODE;
  const id = Math.trunc(Number(contractId) || 0);
  if (id <= 0) return "";
  return `${parent}${String(id).padStart(PAD, "0")}`;
}

/** اسم الحساب الفرعي — الاسم التعاقدي وإلا رقم العقد وإلا #id */
export function subsidiaryName(
  kind: SubsidiaryKind,
  contract: { id: number; contractName?: string | null; contractNumber?: string | null }
): string {
  const label = SUBSIDIARY_KIND_LABEL[kind];
  const name = String(contract.contractName || "").trim();
  if (name) return `${label} — ${name}`;
  const number = String(contract.contractNumber || "").trim();
  if (number) return `${label} — ${number}`;
  return `${label} #${contract.id}`;
}

/** مطابِق أكواد الفرعية — 1121xxxx / 1125xxxx (أربعة أرقام فأكثر بعد الأب) */
export function isSubsidiaryCode(code: string): boolean {
  return /^(1121|1125)\d{4,}$/.test(String(code || "").trim());
}

/** طبيعة الرصيد الافتراضية للفرعي — أصول مدينة دائمًا */
export const SUBSIDIARY_TYPE = "asset" as const;
export const SUBSIDIARY_NATURE = "debit" as const;

// ==================== مواصفات الحسابين للعقد ====================

export interface SubsidiarySpec {
  kind: SubsidiaryKind;
  code: string;
  name: string;
  /** كود حساب التحكم/الأب الذي ينشأ تحته */
  parentCode: string;
}

export interface SubsidiaryContractRef {
  id: number;
  contractName?: string | null;
  contractNumber?: string | null;
}

/** مواصفتا الحسابين (ذمم + WIP) لعقد واحد — مرتبتان: الذمم أولًا */
export function buildSubsidiarySpecs(contract: SubsidiaryContractRef): SubsidiarySpec[] {
  const kinds: SubsidiaryKind[] = ["ar", "wip"];
  return kinds.map((kind) => ({
    kind,
    code: subsidiaryCode(kind, contract.id),
    name: subsidiaryName(kind, contract),
    parentCode: kind === "ar" ? AR_PARENT_CODE : WIP_CONTROL_CODE,
  }));
}

// ==================== توجيه تخصيصات السداد (Task 107) ====================

/** مرجع تخصيص سداد كما يصل من السند */
export interface AllocRef {
  invoiceId: number;
  invoiceNumber: string;
  amount: number;
}

/** سطر دائن موجَّه — حساب كل تخصيص يُحسم نقويًا ثم يُنشر */
export interface RoutedAlloc {
  accountId: number;
  amount: number;
  description: string;
}

/**
 * توجيه دائن كل تخصيص سداد إلى الفرعي لعقد فاتورته:
 *  • الفاتورة لها عقد وله فرعي محسوم ⇒ الفرعي
 *  • وإلا (بلا عقد / بلا فرعي) ⇒ حساب الذمم الافتراضي المحسوم من القاعدة
 * الوصف يبقى «سداد فاتورة {رقم}» كما هو — لا تغيير عرضي.
 */
export function routeAllocations(
  allocs: AllocRef[],
  contractIdByInvoiceId: Map<number, number | null>,
  subIdByContractId: Map<number, number>,
  fallbackArId: number
): RoutedAlloc[] {
  return allocs.map((a) => {
    const contractId = contractIdByInvoiceId.get(a.invoiceId) ?? null;
    const subId = contractId != null ? (subIdByContractId.get(contractId) ?? null) : null;
    return {
      accountId: subId ?? fallbackArId,
      amount: a.amount,
      description: `سداد فاتورة ${a.invoiceNumber}`,
    };
  });
}

// ==================== اشتقاق صف التقرير ====================

/** مدخلات صف الذمم الفرعية — الأستاذ + التشغيل */
export interface SubsidiaryRowInput {
  /** رصيد فرعي الذمم من الأستاذ (افتتاحي + مدين − دائن) — null = الحساب غير مُنشأ */
  arBalance: number | null;
  /** رصيد فرعي WIP من الأستاذ — null = الحساب غير مُنشأ */
  wipBalance: number | null;
  /** إجمالي المفوتر من الفواتير غير الملغاة (تشغيلي) */
  billed: number;
  /** إجمالي المحصّل من الفواتير غير الملغاة (تشغيلي) */
  settled: number;
}

/** صف الذمم الفرعية المعروض — المستحق مشتق لا مخزَّن (G9) */
export interface SubsidiaryRow {
  arBalance: number | null;
  wipBalance: number | null;
  billed: number;
  settled: number;
  outstanding: number;
  /** كلا الحسابين مُنشآن؟ — للشارة في الشاشة */
  provisioned: boolean;
}

export function deriveSubsidiaryRow(input: SubsidiaryRowInput): SubsidiaryRow {
  const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
  const billed = r3(input.billed);
  const settled = r3(input.settled);
  return {
    arBalance: input.arBalance === null ? null : r3(input.arBalance),
    wipBalance: input.wipBalance === null ? null : r3(input.wipBalance),
    billed,
    settled,
    outstanding: r3(billed - settled),
    provisioned: input.arBalance !== null && input.wipBalance !== null,
  };
}
