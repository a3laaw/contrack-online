/**
 * اختبارات نواة «مراجعات المخططات + جسر الإنجاز إلى الفوترة» (docs/revisions-ipc-design.md §4):
 * • نواة المراجعات: الترقيم الآلي · آلة الحالات المغلقة G7 · إلزامية ملاحظة الإرجاع · مؤشرات KPI
 * • جسر readyIpc: تصفية السطور الجاهزة للمستخلص (مُثار/مرحلة مغلقة/غير متخطاة/بلا فاتورة نشطة)
 */
import { describe, expect, test } from "bun:test";
import {
  canDecide,
  canDelete,
  canEdit,
  nextRevNo,
  REVISION_APPROVED,
  REVISION_PENDING,
  REVISION_RETURNED,
  revisionKpis,
  validateDecision,
  validateRevisionInput,
} from "../src/lib/consulting-revision-core";
import { EPS, filterReadyIpcLines, type ReadyIpcLineInput } from "../src/lib/contrack-core";

// ==================== نواة المراجعات ====================

describe("nextRevNo — الترقيم الآلي لكل (عقد، عنوان)", () => {
  test("القائمة الفارغة تبدأ من V1", () => {
    expect(nextRevNo([])).toBe(1);
  });

  test("الإصدارات القائمة ⇒ التالي أعلاها + 1", () => {
    expect(nextRevNo([1, 2, 3])).toBe(4);
    expect(nextRevNo([3, 1])).toBe(4);
  });

  test("القيم غير السليمة تُتجاهل ولا تكسر الترقيم", () => {
    expect(nextRevNo([2, Number.NaN, 0])).toBe(3);
  });
});

describe("آلة حالات المراجعة — G7 مغلقة", () => {
  test("قيد المراجعة فقط يُقرَّر/يُعدَّل/يُحذف", () => {
    expect(canDecide(REVISION_PENDING)).toBe(true);
    expect(canEdit(REVISION_PENDING)).toBe(true);
    expect(canDelete(REVISION_PENDING)).toBe(true);
  });

  test("المحسوم نهائي — لا قرار ولا تعديل ولا حذف", () => {
    for (const s of [REVISION_APPROVED, REVISION_RETURNED]) {
      expect(canDecide(s)).toBe(false);
      expect(canEdit(s)).toBe(false);
      expect(canDelete(s)).toBe(false);
    }
  });
});

describe("validateRevisionInput — تحقق المدخلات", () => {
  test("العنوان إلزامي", () => {
    expect(validateRevisionInput({ title: "   " }).ok).toBe(false);
    expect(validateRevisionInput({}).ok).toBe(false);
  });

  test("عنوان سليم بلا مهندس ⇒ مهندس null", () => {
    const r = validateRevisionInput({ title: "مخطط معماري — الدور الأول" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("مخطط معماري — الدور الأول");
      expect(r.value.engineerId).toBeNull();
    }
  });

  test("مهندس غير صالح ⇒ خطأ", () => {
    expect(validateRevisionInput({ title: "مخطط", engineerId: -3 }).ok).toBe(false);
    expect(validateRevisionInput({ title: "مخطط", engineerId: "abc" }).ok).toBe(false);
  });

  test("تاريخ رفع بصيغة خاطئة ⇒ خطأ", () => {
    expect(validateRevisionInput({ title: "مخطط", submittedAt: "2026/05/01" }).ok).toBe(false);
    expect(validateRevisionInput({ title: "مخطط", submittedAt: "2026-05-01" }).ok).toBe(true);
  });
});

describe("validateDecision — القرار وملاحظة الإرجاع", () => {
  test("اعتماد بلا ملاحظة مقبول", () => {
    const r = validateDecision({ decision: REVISION_APPROVED, note: "" });
    expect(r.ok).toBe(true);
  });

  test("الإرجاع بلا ملاحظة مرفوض — التوثيق إلزامي", () => {
    expect(validateDecision({ decision: REVISION_RETURNED, note: "  " }).ok).toBe(false);
    const r = validateDecision({ decision: REVISION_RETURNED, note: "تعديل الفتحات" });
    expect(r.ok).toBe(true);
  });

  test("قرار مجهول ⇒ خطأ", () => {
    expect(validateDecision({ decision: "مؤجل", note: "" }).ok).toBe(false);
  });
});

describe("revisionKpis — مؤشرات اشتقاقية حصرًا (G9)", () => {
  test("عدّ الحالات + الدورات النشطة (آخر إصدار ليس مقبولًا)", () => {
    const kpis = revisionKpis([
      { title: "مخطط أ", revNo: 1, status: REVISION_APPROVED },
      { title: "مخطط ب", revNo: 1, status: REVISION_RETURNED },
      { title: "مخطط ب", revNo: 2, status: REVISION_PENDING },
      { title: "مخطط ج", revNo: 1, status: REVISION_PENDING },
    ]);
    expect(kpis.pending).toBe(2);
    expect(kpis.approved).toBe(1);
    expect(kpis.returned).toBe(1);
    // «مخطط أ» أُغلق بمقبول — «مخطط ب» (آخره قيد المراجعة) و«مخطط ج» نشطتان
    expect(kpis.activeCycles).toBe(2);
  });

  test("إصدار أقدم مقبول لا يغلق دورة فيها إصدار أحدث معادًا", () => {
    const kpis = revisionKpis([
      { title: "مخطط د", revNo: 1, status: REVISION_APPROVED },
      { title: "مخطط د", revNo: 2, status: REVISION_RETURNED },
    ]);
    expect(kpis.activeCycles).toBe(1);
  });

  test("قائمة فارغة ⇒ أصفار", () => {
    expect(revisionKpis([])).toEqual({ pending: 0, approved: 0, returned: 0, activeCycles: 0 });
  });
});

// ==================== جسر الإنجاز إلى الفوترة (filterReadyIpcLines) ====================

function line(over: Partial<ReadyIpcLineInput>): ReadyIpcLineInput {
  return {
    id: 1,
    title: "دفعة إنجاز مرحلة",
    remaining: 1000,
    triggeredAt: "2026-02-01",
    dueDate: "2026-02-15",
    stage: { name: "الهيكل", endDate: "2026-02-01", isSkipped: false },
    invoiced: false,
    ...over,
  };
}

describe("filterReadyIpcLines — سطور الجاهزين للمستخلص", () => {
  test("سطر مُثار بمرحلة مغلقة وغير مفوتر ⇒ جاهز بالمبلغ المتبقي", () => {
    const out = filterReadyIpcLines([line({})]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      lineId: 1,
      title: "دفعة إنجاز مرحلة",
      amount: 1000,
      stageName: "الهيكل",
      finishDate: "2026-02-01",
      dueDate: "2026-02-15",
    });
  });

  test("غير مُثار (triggeredAt فارغ) ⇒ مستبعد", () => {
    expect(filterReadyIpcLines([line({ triggeredAt: "" })])).toHaveLength(0);
  });

  test("مرحلته مفتوحة (endDate فارغ) أو مفقودة ⇒ مستبعد", () => {
    expect(filterReadyIpcLines([line({ stage: { name: "س", endDate: "", isSkipped: false } })])).toHaveLength(0);
    expect(filterReadyIpcLines([line({ stage: null })])).toHaveLength(0);
  });

  test("مرحلة متخطاة ⇒ مستبعدة", () => {
    expect(filterReadyIpcLines([line({ stage: { name: "س", endDate: "2026-02-01", isSkipped: true } })])).toHaveLength(0);
  });

  test("مفوتر (فاتورة نشطة بنفس السطر) ⇒ مستبعد — لا تكرار فوترة", () => {
    expect(filterReadyIpcLines([line({ invoiced: true })])).toHaveLength(0);
  });

  test("متبقٍ أقل من EPS ⇒ مستبعد (مغطى بالكامل)", () => {
    expect(filterReadyIpcLines([line({ remaining: EPS / 2 })])).toHaveLength(0);
  });

  test("كسور عشرية تُقرَّب لثلاث خانات", () => {
    const out = filterReadyIpcLines([line({ remaining: 1234.56789 })]);
    expect(out[0].amount).toBe(1234.568);
  });

  test("خلط سطور ⇒ الجاهزون فقط بترتيب المدخلات", () => {
    const out = filterReadyIpcLines([
      line({ id: 1, invoiced: true }),
      line({ id: 2, title: "سطر جاهز" }),
      line({ id: 3, triggeredAt: "" }),
      line({ id: 4, title: "سطر جاهز ثانٍ", remaining: 250.5 }),
    ]);
    expect(out.map((r) => r.lineId)).toEqual([2, 4]);
    expect(out[1].amount).toBe(250.5);
  });
});
