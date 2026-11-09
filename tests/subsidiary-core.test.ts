/**
 * اختبارات نواة «الذمم الفرعية الآلية لكل عقد + WIP» — البند الثالث NOVA.
 * docs/subsidiary-wip-design.md — نواة نقية حصرًا (بلا DB): الترقيم الحتمي،
 * الأسماء، المواصفات، توجيه تخصيصات السداد، اشتقاق صف التقرير (G9).
 */
import { describe, expect, test } from "bun:test";

import {
  AR_PARENT_CODE,
  WIP_CONTROL_CODE,
  buildSubsidiarySpecs,
  deriveSubsidiaryRow,
  isSubsidiaryCode,
  routeAllocations,
  subsidiaryCode,
  subsidiaryName,
  type AllocRef,
} from "../src/lib/subsidiary-core";

describe("subsidiaryCode — الترقيم الحتمي", () => {
  test("ذمم عقد 7 ⇒ 11210007 وWIP عقد 7 ⇒ 11250007", () => {
    expect(subsidiaryCode("ar", 7)).toBe("11210007");
    expect(subsidiaryCode("wip", 7)).toBe("11250007");
  });

  test("حشو أربعة أرقام — 1 و42 و999", () => {
    expect(subsidiaryCode("ar", 1)).toBe("11210001");
    expect(subsidiaryCode("ar", 42)).toBe("11210042");
    expect(subsidiaryCode("wip", 999)).toBe("11250999");
  });

  test("فوق 9999 يتوسع تلقائيًا بلا قصّ", () => {
    expect(subsidiaryCode("ar", 12345)).toBe("112112345");
    expect(subsidiaryCode("ar", 12345).startsWith("1121")).toBe(true);
  });

  test("معرف غير سليم ⇒ نص فارغ (حارس)", () => {
    expect(subsidiaryCode("ar", 0)).toBe("");
    expect(subsidiaryCode("ar", -3)).toBe("");
  });
});

describe("subsidiaryName — الأسماء بتسلسل بديل", () => {
  const base = { id: 5, contractNumber: "CON-0005" };
  test("الاسم التعاقدي أولًا", () => {
    expect(subsidiaryName("ar", { ...base, contractName: "برج السالمية" })).toBe(
      "ذمم عقد — برج السالمية"
    );
    expect(subsidiaryName("wip", { ...base, contractName: "برج السالمية" })).toBe(
      "أعمال تحت التنفيذ — برج السالمية"
    );
  });

  test("بلا اسم ⇒ رقم العقد", () => {
    expect(subsidiaryName("ar", { ...base, contractName: "  " })).toBe("ذمم عقد — CON-0005");
  });

  test("بلا اسم ولا رقم ⇒ #id", () => {
    expect(subsidiaryName("ar", { id: 9, contractName: "", contractNumber: "" })).toBe("ذمم عقد #9");
  });
});

describe("isSubsidiaryCode — المطابِق", () => {
  test("فرعية صحيحة بأربعة أرقام فأكثر", () => {
    expect(isSubsidiaryCode("11210007")).toBe(true);
    expect(isSubsidiaryCode("112512345")).toBe(true);
  });

  test("تُرفض الأب والتحكم والقُصَّر وغير الرقمي", () => {
    expect(isSubsidiaryCode("1121")).toBe(false);
    expect(isSubsidiaryCode("1125")).toBe(false);
    expect(isSubsidiaryCode("112100")).toBe(false); // ثلاثة أرقام فقط بعد الأب
    expect(isSubsidiaryCode("11301234")).toBe(false);
    expect(isSubsidiaryCode("")).toBe(false);
  });
});

describe("buildSubsidiarySpecs — مواصفات العقد", () => {
  test("مواصفتان مرتبتان: الذمم أولًا ثم WIP، بالكودين والأبين الصحيحين", () => {
    const specs = buildSubsidiarySpecs({ id: 12, contractName: "مجمع الفروانية", contractNumber: "CON-0012" });
    expect(specs).toHaveLength(2);
    expect(specs[0].kind).toBe("ar");
    expect(specs[0].code).toBe("11210012");
    expect(specs[0].parentCode).toBe(AR_PARENT_CODE);
    expect(specs[0].name).toBe("ذمم عقد — مجمع الفروانية");
    expect(specs[1].kind).toBe("wip");
    expect(specs[1].code).toBe("11250012");
    expect(specs[1].parentCode).toBe(WIP_CONTROL_CODE);
    expect(specs[1].name).toBe("أعمال تحت التنفيذ — مجمع الفروانية");
  });
});

describe("routeAllocations — توجيه دائن تخصيصات السداد", () => {
  const allocs: AllocRef[] = [
    { invoiceId: 101, invoiceNumber: "INV-0001", amount: 500 },
    { invoiceId: 102, invoiceNumber: "INV-0002", amount: 250 },
    { invoiceId: 103, invoiceNumber: "INV-0003", amount: 125 },
  ];
  // عقد 7 له فرعي 9001 — عقد 8 بلا فرعي — فاتورة 103 بلا عقد
  const contractIdByInvoiceId = new Map<number, number | null>([
    [101, 7],
    [102, 8],
    [103, null],
  ]);
  const subIdByContractId = new Map<number, number>([[7, 9001]]);

  test("فاتورة بعقد له فرعي ⇒ الفرعي", () => {
    const routed = routeAllocations(allocs, contractIdByInvoiceId, subIdByContractId, 7777);
    expect(routed[0]).toEqual({ accountId: 9001, amount: 500, description: "سداد فاتورة INV-0001" });
  });

  test("فاتورة بعقد بلا فرعي ⇒ الحساب الأب المحسوم", () => {
    const routed = routeAllocations(allocs, contractIdByInvoiceId, subIdByContractId, 7777);
    expect(routed[1].accountId).toBe(7777);
    expect(routed[1].amount).toBe(250);
  });

  test("فاتورة بلا عقد ⇒ الحساب الأب المحسوم", () => {
    const routed = routeAllocations(allocs, contractIdByInvoiceId, subIdByContractId, 7777);
    expect(routed[2].accountId).toBe(7777);
  });

  test("المبالغ والأوصاف تبقى كما هي لكل التخصيصات", () => {
    const routed = routeAllocations(allocs, contractIdByInvoiceId, subIdByContractId, 7777);
    expect(routed.map((r) => r.amount)).toEqual([500, 250, 125]);
    expect(routed.every((r) => r.description.startsWith("سداد فاتورة INV-"))).toBe(true);
  });

  test("خريطة عقد مفقودة أصلاً (فاتورة محذوفة) ⇒ الأب بلا انهيار", () => {
    const partial = new Map<number, number | null>([[101, 7]]);
    const routed = routeAllocations([allocs[1]], partial, subIdByContractId, 7777);
    expect(routed[0].accountId).toBe(7777);
  });
});

describe("deriveSubsidiaryRow — اشتقاق صف التقرير (G9)", () => {
  test("المستحق = مفوتر − محصّل، والتقريب لثلاث خانات", () => {
    const row = deriveSubsidiaryRow({ arBalance: 1200.0004, wipBalance: 0, billed: 1500.0004, settled: 300.0001 });
    expect(row.outstanding).toBe(1200);
    expect(row.arBalance).toBe(1200);
    expect(row.billed).toBe(1500);
    expect(row.settled).toBe(300);
  });

  test("provisioned تتحقق بوجود الحسابين معًا", () => {
    const both = deriveSubsidiaryRow({ arBalance: 10, wipBalance: 5, billed: 10, settled: 0 });
    expect(both.provisioned).toBe(true);
    const noAr = deriveSubsidiaryRow({ arBalance: null, wipBalance: 5, billed: 10, settled: 0 });
    expect(noAr.provisioned).toBe(false);
    const noWip = deriveSubsidiaryRow({ arBalance: 10, wipBalance: null, billed: 10, settled: 0 });
    expect(noWip.provisioned).toBe(false);
  });

  test("null تمر كما هي (حساب غير مُنشأ ⇒ «—» في الشاشة)", () => {
    const row = deriveSubsidiaryRow({ arBalance: null, wipBalance: null, billed: 0, settled: 0 });
    expect(row.arBalance).toBeNull();
    expect(row.wipBalance).toBeNull();
    expect(row.outstanding).toBe(0);
  });
});
