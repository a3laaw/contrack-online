// ============================================================
// اختبارات نواة «الإقفال الكمّي للمراحل» (بند NOVA 6)
// docs/stage-quantum-design.md — نواة نقية بلا قاعدة بيانات
// ============================================================
import { describe, expect, it } from "bun:test";
import { deriveStageQuantum, QUANTUM_EPS } from "../src/lib/stage-quantum-core";

describe("اشتقاق الحالة الكمّية للمراحل", () => {
  it("مرحلة مكتملة: كل بند نُفذ بالكامل ⇒ complete=true وقائمة نقص فارغة", () => {
    const rows = deriveStageQuantum([
      { stageId: 1, boqItemId: 11, effectiveQty: 100, executedQty: 100 },
      { stageId: 1, boqItemId: 12, effectiveQty: 50, executedQty: 60 },
    ]);
    expect(rows).toHaveLength(1);
    const q = rows[0];
    expect(q.stageId).toBe(1);
    expect(q.itemsCount).toBe(2);
    expect(q.complete).toBe(true);
    expect(q.shortfall).toHaveLength(0);
    // نسبة العرض من المجموع: (100+60)/(100+50) = 106.7٪ — يتجاوز 100 بلا قصّ
    expect(q.executedPct).toBe(106.7);
  });

  it("مرحلة ناقصة: البوابة بند-ببند — عجز بند لا يعوضه فائض آخر ⇒ complete=false", () => {
    const rows = deriveStageQuantum([
      { stageId: 7, boqItemId: 71, effectiveQty: 100, executedQty: 150 }, // فائض لا يُعدل
      { stageId: 7, boqItemId: 72, effectiveQty: 80, executedQty: 30, description: "سلك 2.5مم" },
    ]);
    const q = rows[0];
    expect(q.complete).toBe(false);
    expect(q.shortfall).toHaveLength(1);
    const s = q.shortfall[0];
    expect(s.boqItemId).toBe(72);
    expect(s.description).toBe("سلك 2.5مم");
    expect(s.remaining).toBe(50);
    expect(q.executedPct).toBe(100); // (150+30)/(100+80) = 100٪ — النسبة تعرض والبوابة ترفض
  });

  it("حد السماحية ε: ناقص أقل من ε مكتمل، وأكثر منه ناقص", () => {
    const eff = 100;
    const okRows = deriveStageQuantum([
      { stageId: 1, boqItemId: 1, effectiveQty: eff, executedQty: eff - QUANTUM_EPS }, // 99.9995 — ضمن السماحية
    ]);
    expect(okRows[0].complete).toBe(true);
    const badRows = deriveStageQuantum([
      { stageId: 1, boqItemId: 1, effectiveQty: eff, executedQty: eff - 0.001 }, // منزلة كاملة ناقصة
    ]);
    expect(badRows[0].complete).toBe(false);
    expect(badRows[0].shortfall[0].remaining).toBe(0.001);
  });

  it("تجميع عدة مراحل بترتيب أول ظهور وعدم اختلاط البنود", () => {
    const rows = deriveStageQuantum([
      { stageId: 5, boqItemId: 51, effectiveQty: 10, executedQty: 10 },
      { stageId: 2, boqItemId: 21, effectiveQty: 4, executedQty: 1 },
      { stageId: 5, boqItemId: 52, effectiveQty: 6, executedQty: 3 },
    ]);
    expect(rows.map((r) => r.stageId)).toEqual([5, 2]); // ترتيب أول ظهور لا ترتيب رقمي
    const s5 = rows[0];
    expect(s5.itemsCount).toBe(2);
    expect(s5.complete).toBe(false);
    expect(s5.executedPct).toBe(81.3); // (10+3)/(10+6)
    const s2 = rows[1];
    expect(s2.complete).toBe(false);
    expect(s2.shortfall[0].remaining).toBe(3);
  });

  it("مرحلة بلا بنود لا تنتج صفًا — قابلية التطبيق لصاحب المرحلة", () => {
    expect(deriveStageQuantum([])).toEqual([]);
  });

  it("بند بلا وصف يسمّى افتراضيًا بمعرفه في قائمة النقص", () => {
    const rows = deriveStageQuantum([
      { stageId: 3, boqItemId: 33, effectiveQty: 2, executedQty: 0 },
    ]);
    expect(rows[0].shortfall[0].description).toBe("بند #33");
  });

  it("تنفيذ زائد على كل البنود يبقى مكتملًا ونسبة العرض فوق المئة بمنزلة واحدة", () => {
    const rows = deriveStageQuantum([
      { stageId: 9, boqItemId: 91, effectiveQty: 3, executedQty: 9.555 },
      { stageId: 9, boqItemId: 92, effectiveQty: 3, executedQty: 3.111 },
    ]);
    expect(rows[0].complete).toBe(true);
    expect(rows[0].executedPct).toBe(211.1); // (9.555+3.111)/6 = 211.1
  });
});
