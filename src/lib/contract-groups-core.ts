/**
 * منطق مجموعات العقود النقي — مرآة حرفية للمكتبي contract_group_service.py:
 *   next_group_number (:11-25) · _validate_contracts (:28-47) · list_groups (:81-151)
 * «ضم عدة عقود مستقلة في حزمة متابعة واحدة — ربط تنظيمي فقط»
 * لا تدمج العقود ماليًا ولا تغيّر نوعها (تصميم + إشراف + كتب بلدية كعقود مستقلة).
 */

import { round3 } from "@/lib/format";

/** حالة الإلغاء كما تُخزَّن في العقود — تُستبعد من المجموعات والملخص المالي */
export const GROUP_CANCELLED = "ملغى";

/**
 * الترقيم الآلي للمجموعات (next_group_number — GRP-%04d):
 * يقرأ أعلى رقم موجود ويزيد 1؛ بلا سابق أو بصيغة تالفة ⇒ GRP-0001.
 */
export function nextGroupNumber(last?: string | null): string {
  let n = 1;
  if (last) {
    const m = last.match(/GRP-(\d+)/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (Number.isFinite(parsed)) n = parsed + 1;
    }
  }
  return `GRP-${String(n).padStart(4, "0")}`;
}

/** إزالة تكرار الاختيار مع إسقاط الفارغ وحفظ الترتيب (كالمكتبي) */
export function dedupeContractIds(ids: Array<number | null | undefined>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface GroupContractsInput {
  ids: number[];
  customerIds: number[];
  statuses: string[];
}

/**
 * قواعد الضم حرفيًا (ترتيب المكتبي):
 * عقدين على الأقل ⇒ كل معرف له صف مجلوب ⇒ نفس العميل ⇒ لا عقد ملغى.
 */
export function validateGroupContracts(input: GroupContractsInput): void {
  if (input.ids.length < 2) {
    throw new Error("اختر عقدين على الأقل للضم في مجموعة واحدة.");
  }
  if (input.ids.length !== input.customerIds.length || input.ids.length !== input.statuses.length) {
    throw new Error("يوجد عقد غير موجود ضمن الاختيارات.");
  }
  const first = input.customerIds[0];
  for (const cid of input.customerIds) {
    if (cid !== first) {
      throw new Error("لا يمكن ضم عقود عملاء مختلفين في نفس المجموعة.");
    }
  }
  for (const st of input.statuses) {
    if (st === GROUP_CANCELLED) {
      throw new Error("لا يمكن ضم عقد ملغى داخل مجموعة جديدة.");
    }
  }
}

export interface GroupTotalRow {
  status: string;
  current: number;
  collected: number;
  paid: number;
  subs: number;
}

export interface GroupTotals {
  currentTotal: number;
  collectedTotal: number;
  paidTotal: number;
  subsTotal: number;
  costTotal: number;
  profitTotal: number;
  margin: number;
}

/**
 * الملخص المالي للمجموعة (list_groups :121-148) — صفوف العقود الملغاة مستثناة:
 * cost = paid + max(0, subs − paid)  (المنصرف + باقي التزامات الباطن)
 * profit = collected − cost · margin = profit/collected×100 (بمحصّل > 0.001)
 */
export function computeGroupTotals(rows: GroupTotalRow[]): GroupTotals {
  let currentTotal = 0;
  let collectedTotal = 0;
  let paidTotal = 0;
  let subsTotal = 0;
  for (const r of rows) {
    if (r.status === GROUP_CANCELLED) continue;
    currentTotal += r.current;
    collectedTotal += r.collected;
    paidTotal += r.paid;
    subsTotal += r.subs;
  }
  currentTotal = round3(currentTotal);
  collectedTotal = round3(collectedTotal);
  paidTotal = round3(paidTotal);
  subsTotal = round3(subsTotal);
  const costTotal = round3(paidTotal + Math.max(0, subsTotal - paidTotal));
  const profitTotal = round3(collectedTotal - costTotal);
  const margin = collectedTotal > 0.001 ? round3((profitTotal / collectedTotal) * 100) : 0;
  return { currentTotal, collectedTotal, paidTotal, subsTotal, costTotal, profitTotal, margin };
}
