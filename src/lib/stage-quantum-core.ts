// ============================================================
// stage-quantum-core.ts — نواة «الإقفال الكمّي للمراحل» (بند NOVA 6)
// المرجع: docs/stage-quantum-design.md — الحلقة المالية تكتمل بلا أتمتة صامتة:
// النظام يُسند قرار الإقفال بالأدلة (شارات + إشعارات + تحذير استشاري)،
// والإقفال نفسه يبقى بيد الإنسان لأنه يحرّك المال (استحقاق الخطة).
// القرار الجوهري (درس G9): حالة المرحلة الكمّية **مشتقة من الصفوف لحظيًا
// لا مخزنة** — حذف/تعديل سجل تنفيذ أو فكّ ارتباط بند يعيد الاحتساب فورًا.
// نواة نقية حصرًا (بلا DB ولا server-only) — قابلة للاختبار مباشرة،
// ويُعاد استخدامها في العميل لتوليد رقائق المقايسة من نفس المصدر.
// ============================================================

/** تقريب لثلاث خانات عشرية — مرآة r3 في contrack-core (محلية لتبقى النواة بلا استيرادات) */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** تقريب لمنزلة واحدة — نسب العرض */
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * سماحية البوابة: executed ≥ effective − EPS تعتبر اكتمالًا — تمتص ضوضاء
 * الفاصلة العائمة حول قيم r3 المتطابقة (0.0005 < نصف آخر منزلة معنوية 0.001).
 */
export const QUANTUM_EPS = 0.0005;

/** مدخل كمّي لبند مرتبط بمرحلة (أرقام محوَّلة من القاعدة — effective = كمية البند الفعلية بعد الملحقات) */
export interface StageQuantumItemInput {
  stageId: number;
  boqItemId: number;
  effectiveQty: number;
  executedQty: number;
  description?: string;
}

/** بند متخلف عن الاكتمال — «الأدلة» المعروضة للمرحلة الناقصة */
export interface StageQuantumShortfall {
  boqItemId: number;
  description: string;
  effectiveQty: number;
  executedQty: number;
  remaining: number; // max(0, effective − executed) مقرب r3
}

/** حالة المرحلة الكمّية المشتقة — لا حالة مخزنة (G9) */
export interface StageQuantum {
  stageId: number;
  itemsCount: number; // عدد البنود المرتبطة غير المحذوفة
  complete: boolean; // البوابة: كل بند نُفذ بالكامل (بند-ببند لا مجموع)
  executedPct: number; // Σ executed / Σ effective بالكمية — عرض فقط، قد يتجاوز 100%
  shortfall: StageQuantumShortfall[]; // بنود النقص بترتيبها الوارد — فارغة = مكتملة
}

/**
 * اشتقاق حالات المراحل الكمّية من مدخلات البنود:
 * - التجميع بالمرحلة، والنتيجة مرتبة بترتيب أول ظهور للمرحلة (استقرار العرض)
 * - مرحلة بلا بنود لا تُنتج صفًا إطلاقًا — قابلية التطبيق قرار صاحب المرحلة:
 *   المرحلة الزمنية/الخدمية تُغلق يدويًا كما اليوم (تصميم §2)
 * - pct على قاعدة صفر = صفر (نمط summarizeTakeoff)
 */
export function deriveStageQuantum(items: StageQuantumItemInput[]): StageQuantum[] {
  const byStage = new Map<number, StageQuantumItemInput[]>();
  const order: number[] = [];
  for (const it of items) {
    if (!byStage.has(it.stageId)) {
      byStage.set(it.stageId, []);
      order.push(it.stageId);
    }
    byStage.get(it.stageId)!.push(it);
  }
  return order.map((stageId) => {
    const rows = byStage.get(stageId)!;
    const shortfall: StageQuantumShortfall[] = [];
    let effectiveSum = 0;
    let executedSum = 0;
    for (const r of rows) {
      const effective = r3(r.effectiveQty);
      const executed = r3(r.executedQty);
      effectiveSum += effective;
      executedSum += executed;
      if (executed < effective - QUANTUM_EPS) {
        shortfall.push({
          boqItemId: r.boqItemId,
          description: r.description || `بند #${r.boqItemId}`,
          effectiveQty: effective,
          executedQty: executed,
          remaining: r3(Math.max(0, effective - executed)),
        });
      }
    }
    return {
      stageId,
      itemsCount: rows.length,
      complete: shortfall.length === 0,
      executedPct: effectiveSum > 0 ? r1((executedSum / effectiveSum) * 100) : 0,
      shortfall,
    };
  });
}
