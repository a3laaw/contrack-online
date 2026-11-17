/**
 * opportunities-core.test.ts — اختبارات نواة ر3 «فرص البيع» النقية (docs/opportunities-design.md §4/§8):
 * • مصفوفة الانتقالات المغلقة (د2) · إلزامية سبب الخسارة عند «مفقودة» (د3)
 * • المزامنة الآلية مع أحداث العرض (د4) · مؤشرات خط الأنابيب الاشتقاقية (G9)
 */
import { describe, expect, test } from "bun:test";

import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_QUOTED_STAGE,
  opportunityAllowedTargets,
  opportunityStageBadgeClass,
  opportunityTransitionAllowed,
  isOpportunityStage,
} from "../src/lib/opportunities-constants";
import {
  AUTO_LOST_REASON,
  assertStageTransition,
  autoStageForQuotationEvent,
  buildOpportunityQuotePreset,
  cleanOpportunityDate,
  cleanOpportunityText,
  isOpportunityLostReason,
  pipelineKpis,
} from "../src/lib/opportunities-core";

describe("مفردات الفرص المغلقة (G7)", () => {
  test("المراحل الخمس والانتقالات المسموحة فقط", () => {
    expect(OPPORTUNITY_STAGES).toEqual(["جديدة", "مؤهَّلة", "عُرض عليها", "مقبولة", "مفقودة"]);
    expect(opportunityAllowedTargets("جديدة")).toEqual(["مؤهَّلة", "مفقودة"]);
    expect(opportunityAllowedTargets("مؤهَّلة")).toEqual(["عُرض عليها", "مفقودة"]);
    expect(opportunityAllowedTargets("عُرض عليها")).toEqual(["مقبولة", "مفقودة"]);
    // النهائيتان بلا أهداف
    expect(opportunityAllowedTargets("مقبولة")).toEqual([]);
    expect(opportunityAllowedTargets("مفقودة")).toEqual([]);
    expect(opportunityTransitionAllowed("جديدة", "عُرض عليها")).toBeFalse(); // لا قفز مرحلتين
    expect(isOpportunityStage("مؤهَّلة")).toBeTrue();
    expect(isOpportunityStage("مرحلة وهمية")).toBeFalse();
    expect(isOpportunityLostReason("سعر مرتفع")).toBeTrue();
    expect(isOpportunityLostReason("سبب غير معتمد")).toBeFalse();
    expect(OPPORTUNITY_LOST_REASONS.length).toBeGreaterThan(3);
    expect(OPPORTUNITY_QUOTED_STAGE).toBe("عُرض عليها");
  });

  test("شارات المراحل من لوحة NOVA حصرًا", () => {
    expect(opportunityStageBadgeClass("مؤهَّلة")).toBe("bg-status-warn-bg text-warn-ink");
    expect(opportunityStageBadgeClass("عُرض عليها")).toBe("bg-status-info-bg text-status-info");
    expect(opportunityStageBadgeClass("مقبولة")).toBe("bg-status-done-bg text-status-done");
    expect(opportunityStageBadgeClass("مفقودة")).toBe("bg-status-danger-bg text-status-danger");
    expect(opportunityStageBadgeClass("غير معروف")).toBe("bg-secondary text-secondary-foreground");
  });
});

describe("حرس انتقال المرحلة اليدوي", () => {
  test("الانتقال المسموح يمر والمنعوت برسالة عربية", () => {
    expect(assertStageTransition("جديدة", "مؤهَّلة", "")).toEqual({ ok: true });
    const blocked = assertStageTransition("جديدة", "مقبولة", "");
    expect(blocked.ok).toBeFalse();
    if (!blocked.ok) expect(blocked.error).toContain("غير مسموح");
  });

  test("«مفقودة» بلا سبب ترفض — وبسبب تمر", () => {
    const noReason = assertStageTransition("مؤهَّلة", "مفقودة", "");
    expect(noReason.ok).toBeFalse();
    if (!noReason.ok) expect(noReason.error).toContain("سبب الخسارة إلزامي");
    expect(assertStageTransition("مؤهَّلة", "مفقودة", "سعر مرتفع")).toEqual({ ok: true });
  });

  test("المقفلة لا تتحرك من أي مسار", () => {
    for (const closed of ["مقبولة", "مفقودة"]) {
      const r = assertStageTransition(closed, "جديدة", "");
      expect(r.ok).toBeFalse();
      if (!r.ok) expect(r.error).toContain("مقفلة");
    }
  });

  test("لا تغيير (نفس المرحلة) يُقبل بلا سبب", () => {
    expect(assertStageTransition("عُرض عليها", "عُرض عليها", "")).toEqual({ ok: true });
  });
});

describe("المزامنة الآلية مع أحداث العرض (د4)", () => {
  test("إصدار العرض يرفع إلى «عُرض عليها» — والقبول إلى «مقبولة» — والرفض إلى «مفقودة»", () => {
    expect(autoStageForQuotationEvent("جديدة", "issued")).toBe("عُرض عليها");
    expect(autoStageForQuotationEvent("مؤهَّلة", "issued")).toBe("عُرض عليها");
    expect(autoStageForQuotationEvent("عُرض عليها", "issued")).toBeNull(); // بلا تغيير
    expect(autoStageForQuotationEvent("عُرض عليها", "accepted")).toBe("مقبولة");
    expect(autoStageForQuotationEvent("عُرض عليها", "rejected")).toBe("مفقودة");
    expect(autoStageForQuotationEvent("جديدة", "accepted")).toBe("مقبولة"); // أثر القبول يتجاوز المسار اليدوي
  });

  test("المقفلة لا تتحرك بأي حدث عرض", () => {
    expect(autoStageForQuotationEvent("مقبولة", "rejected")).toBeNull();
    expect(autoStageForQuotationEvent("مفقودة", "issued")).toBeNull();
    expect(autoStageForQuotationEvent("مقبولة", "issued")).toBeNull();
  });

  test("سبب الرفض الآلي معتمد في القائمة", () => {
    expect(isOpportunityLostReason(AUTO_LOST_REASON)).toBeTrue();
  });
});

describe("مؤشرات خط الأنابيب (G9 — اشتقاقية)", () => {
  test("الأعداد والمفتوح والمقفل ومعدل التحويل", () => {
    const k = pipelineKpis([
      { stage: "جديدة", expectedAmount: 1000 },
      { stage: "مؤهَّلة", expectedAmount: 2500 },
      { stage: "عُرض عليها", expectedAmount: 4000 },
      { stage: "مقبولة", expectedAmount: 3000 },
      { stage: "مفقودة", expectedAmount: 500 },
    ]);
    expect(k.byStage["جديدة"]).toBe(1);
    expect(k.byStage["مؤهَّلة"]).toBe(1);
    expect(k.byStage["عُرض عليها"]).toBe(1);
    expect(k.openExpected).toBe(7500); // المفتوح لا يشمل المقفل
    expect(k.closedCount).toBe(2);
    expect(k.wonCount).toBe(1);
    expect(k.lostCount).toBe(1);
    expect(k.conversionRate).toBe(0.5);
  });

  test("بلا بيانات — أصفار وبلا قسمة على صفر", () => {
    const k = pipelineKpis([]);
    expect(k.openExpected).toBe(0);
    expect(k.closedCount).toBe(0);
    expect(k.conversionRate).toBe(0);
    for (const s of OPPORTUNITY_STAGES) expect(k.byStage[s]).toBe(0);
  });

  test("مرحلة غير معروفة تُتجاهل لا تُفجّر", () => {
    const k = pipelineKpis([{ stage: "وهمية", expectedAmount: 99 }]);
    expect(k.byStage["جديدة"]).toBe(0);
    expect(k.openExpected).toBe(0);
  });
});

describe("التشذيب والحمولة", () => {
  test("cleanOpportunityText يقص وينظف — والتاريخ يرفض الأنماط غير YYYY-MM-DD", () => {
    expect(cleanOpportunityText("  فرصة برج سالم  ")).toBe("فرصة برج سالم");
    expect(cleanOpportunityText(null)).toBe("");
    expect(cleanOpportunityDate("2026-11-20")).toBe("2026-11-20");
    expect(cleanOpportunityDate("20/11/2026")).toBe("");
    expect(cleanOpportunityDate("")).toBe("");
  });

  test("حمولة إصدار العرض من الفرصة (د4)", () => {
    const p = buildOpportunityQuotePreset({
      id: 7,
      opportunityNumber: "OPP-0001",
      name: "توريد مجمع تجاري",
      customerId: 3,
      customerName: "شركة الأفق",
    });
    expect(p.opportunityId).toBe(7);
    expect(p.customerId).toBe(3);
    expect(p.customerName).toBe("شركة الأفق");
    const p2 = buildOpportunityQuotePreset({ id: 8, opportunityNumber: "OPP-0002", name: "x", customerId: null });
    expect(p2.customerId).toBeNull();
    expect(p2.customerName).toBe("");
  });
});
