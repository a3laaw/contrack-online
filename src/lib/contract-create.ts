/**
 * منطق إنشاء العقد المشترك (المرحلة 3/ج) — نقّي قابل للاختبار:
 *  1) amount_guard — مطابقة المكتبي ui/contracts.py:_check_amount_consistency:
 *     الفرق بين قيمة العقد ومجموع الدفعات (>0.001) ⇒
 *       الميزة معطّلة ⇒ منع صارم (السلوك القديم برسالة الأصل الحرفية)
 *       الميزة مفعّلة ⇒ خيارات: تحديث المبلغ / توزيع الدفعات / حفظ بالفرق
 *  2) توزيع نسبي — مطابقة ui/contracts.py:_rescale_plan_to:
 *     كل الصفوف إلا الأخيرة round(old/total×amount, 3) والأخيرة تأخذ الباقي.
 *  3) توليد خطة الدفعات من قالب النوع — مطابقة
 *     workflow_service.py:_generate_type_payments_from_template + type_payment_preview:
 *     نسبة ⇒ amount×pct/100 · مبلغ يدوي ⇒ amountFixed · مرنة ⇒ تُتخطى (بلا مبلغ) ·
 *     الاستحقاق = تاريخ العقد + daysOffset.
 */

export interface AmountGuardProblem {
  label: string; // «مجموع الدفعات»
  total: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt3 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const AMOUNT_POLICIES = ["update_amount", "scale_plan", "keep_diff"] as const;
export type AmountPolicy = (typeof AMOUNT_POLICIES)[number];

/** هل يوجد فرق بين قيمة العقد ومجموع الدفعات؟ (عتبة 0.001 كالأصل) */
export function amountGuardProblems(amount: number, planTotal: number | null): AmountGuardProblem[] {
  const problems: AmountGuardProblem[] = [];
  if (planTotal !== null && Math.abs(planTotal - amount) > 0.001) {
    problems.push({ label: "مجموع الدفعات", total: planTotal });
  }
  return problems;
}

/** رسالة المنع الصارم الحرفية من المكتبي (حين amount_guard معطّلة) */
export function amountGuardStrictMessage(amount: number, problems: AmountGuardProblem[]): string {
  const lines = problems.map(
    (p) => `${p.label}: ${fmt3(p.total)} د.ك (الفرق ${fmt3(p.total - amount)})`
  );
  return `قيمة العقد: ${fmt3(amount)} د.ك\n` + lines.join("\n") + "\n\nعدّل القيم حتى تتساوى قبل الحفظ.";
}

/** توزيع نسبي حرفي على المبلغ — الأخيرة تأخذ الباقي (مطابقة _rescale_plan_to) */
export function scalePlanAmounts(
  amounts: number[],
  target: number
): number[] {
  const positive = amounts.filter((a) => Number(a) > 0);
  const total = r3(positive.reduce((s, a) => s + a, 0));
  if (total <= 0 || !positive.length) return [...amounts];
  const count = positive.length;
  const out: number[] = [];
  let acc = 0;
  let seen = 0;
  for (const a of amounts) {
    if (!(Number(a) > 0)) {
      out.push(0);
      continue;
    }
    seen += 1;
    if (seen < count) {
      const next = Math.round((Number(a) / total) * target * 1000) / 1000;
      acc = r3(acc + next);
      out.push(next);
    } else {
      out.push(r3(target - acc));
    }
  }
  return out;
}

/** صف دفعة مولَّدة من القالب */
export interface TemplatePlanRow {
  title: string;
  amount: number;
  dueDate: string; // yyyy-MM-dd
  /** مرحلة ربط القالب (workflow_stage) — تُطابق بالاسم مع نسخة العقد */
  triggerStageId?: number | null;
}

/** إضافة أيام تقويمية لنص تاريخ yyyy-MM-dd (أجزاء UTC) */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

export interface TemplatePaymentLike {
  title: string;
  pct: number;
  amountFixed: number;
  daysOffset: number;
  triggerStageId?: number | null;
}

/**
 * صفوف الخطة من قالب النوع — مطابقة type_payment_preview:
 * pct>0 ⇒ نسبة من قيمة العقد · amountFixed>0 ⇒ المبلغ كما هو · كلاهما صفر ⇒ «مرنة» تُتخطى.
 * (مطابقة _generate_type_payments_from_template: الدفعة بلا مبلغ لا تُدرَج أصلًا.)
 */
export function templatePlanRows(
  templates: TemplatePaymentLike[],
  amount: number,
  startDay: string
): TemplatePlanRow[] {
  if (!(Number(amount) > 0) || !startDay) return [];
  const rows: TemplatePlanRow[] = [];
  let seq = 0;
  for (const t of templates) {
    const pct = Number(t.pct || 0);
    const fixed = Number(t.amountFixed || 0);
    let payAmount = 0;
    if (pct > 0) payAmount = r3((Number(amount) * pct) / 100.0);
    else if (fixed > 0) payAmount = r3(fixed);
    if (payAmount <= 0) continue; // «مرنة» — تُحدد لاحقًا ولا تُدرج
    seq += 1;
    rows.push({
      title: (t.title || "").trim() || `الدفعة ${seq}`,
      amount: payAmount,
      dueDate: addDays(startDay, Number(t.daysOffset || 0)),
      triggerStageId: t.triggerStageId ?? null,
    });
  }
  return rows;
}
