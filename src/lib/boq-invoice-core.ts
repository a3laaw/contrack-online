// ============================================================
// boq-invoice-core.ts — نواة ز1 النقية (بلا I/O)
// ------------------------------------------------------------
// docs/boq-state-timeline-design.md §2 — ربط أسطر مستخلص العميل ببنود BOQ:
//  • حارس المتاح: Σ كميات الأسطر على البند في الفاتورة ≤ كمية البند − Σ المعتمد السابق
//    (مرآة حارس SubIPC §3.4 في phase-a-core)
//  • لقطة الاعتماد cumulativeQty — مرآة حرفية لـSubCertificateLine.cumulativeQty
//    (retention-design §3.2)؛ ز2 سينقل لحظة التجميد من الإصدار إلى الاعتماد
// كل الدوال نقية قابلة للاختبار المباشر (نمط *-core.ts الموحد)
// ============================================================

import { EPS, r3 } from "./contrack-core";

/** المتاح من بند BOQ للفوترة = كميته − Σ المفوتر السابق (غير الملغاة) — مرآة subItemAvailable */
export function boqItemAvailable(itemQty: number, invoicedBefore: number): number {
  return r3(Math.max(0, r3(itemQty) - Math.max(0, invoicedBefore)));
}

export interface InvoiceBoqLineInput {
  boqItemId: number | null;
  qty: number;
}

/**
 * حارس المتاح (§2 — مرآة SubIPC §3.4):
 * يُجمَّع على الأسطر داخل الفاتورة أولًا (سطران على البند نفسه = مطلب واحد)،
 * ثم يُقارن المجمَّع بالمتاح لكل بند — التجاوز يُرفض برسالة صريحة برقم أول سطر على البند.
 * الدالة نقية — جلب المتاحات (كمية البند − Σ المفوتر السابق) مسؤولية المستدعي.
 */
export function validateInvoiceBoqLines(
  lines: InvoiceBoqLineInput[],
  availabilityByBoqItemId: Map<number, number>
): { ok: true } | { ok: false; error: string } {
  // أول رقم سطر لكل بند + إجمالي الكمية المطلوبة عليه داخل هذه الفاتورة
  const firstLineByItem = new Map<number, number>();
  const totalByItem = new Map<number, number>();
  for (const [i, l] of lines.entries()) {
    if (l.boqItemId == null || l.boqItemId <= 0) continue; // سطر حر — بلا حارس
    if (!(l.qty > 0)) continue; // صحة الكمية تحققها مسارات الفواتير القائمة
    if (!firstLineByItem.has(l.boqItemId)) firstLineByItem.set(l.boqItemId, i);
    totalByItem.set(l.boqItemId, r3((totalByItem.get(l.boqItemId) || 0) + l.qty));
  }
  for (const [boqItemId, wanted] of totalByItem) {
    const available = availabilityByBoqItemId.get(boqItemId);
    if (available === undefined) {
      return { ok: false, error: `السطر ${(firstLineByItem.get(boqItemId) ?? 0) + 1}: بند BOQ غير موجود في بنود هذا العقد` };
    }
    if (wanted > available + EPS) {
      return {
        ok: false,
        error: `السطر ${(firstLineByItem.get(boqItemId) ?? 0) + 1}: إجمالي الكمية على البند (${wanted}) تتجاوز المتاح (${available})`,
      };
    }
  }
  return { ok: true };
}

/**
 * لقطات التراكمي لحظة الإصدار (ز1) — لكل سطر: تراكمي البند حتى هذا السطر شاملًا =
 * المفوتر السابق على البند + Σ كميات أسطر هذه الفاتورة على البند بالترتيب حتى السطر نفسه.
 * الأسطر الحرة (بلا بند) لقطة 0 — وز2 سينقل لحظة التجميد إلى الاعتماد.
 */
export function computeCumulativeSnapshots(
  lines: InvoiceBoqLineInput[],
  invoicedBeforeByBoqItemId: Map<number, number>
): number[] {
  const running = new Map<number, number>();
  return lines.map((l) => {
    if (l.boqItemId == null || l.boqItemId <= 0) return 0;
    const prev = Math.max(0, invoicedBeforeByBoqItemId.get(l.boqItemId) || 0);
    const run = r3((running.get(l.boqItemId) || 0) + Math.max(0, l.qty));
    running.set(l.boqItemId, run);
    return r3(prev + run);
  });
}
