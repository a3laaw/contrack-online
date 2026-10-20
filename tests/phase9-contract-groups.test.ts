/**
 * اختبار المرحلة 9-أ — مجموعات العقود (Contract Groups)
 * قفل المنطق النقي المطابق للمكتبي V9.15.18:
 *   contract_group_service.py:11-25  next_group_number (GRP-%04d بقراءة أعلى رقم)
 *   contract_group_service.py:28-47  _validate_contracts (عقدين+نفس العميل+لا ملغى)
 *   contract_group_service.py:81-151 list_groups (الملخص المالي — الملغى مستثنى)
 *   :134  cost_total = paid + max(0, subs − paid)
 *   :139-148  profit = collected − cost و margin% من المحصّل
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  computeGroupTotals,
  dedupeContractIds,
  nextGroupNumber,
  validateGroupContracts,
  type GroupTotalRow,
} from "@/lib/contract-groups-core";

describe("nextGroupNumber — الترقيم الآلي GRP-%04d (مرآة next_group_number)", () => {
  test("من آخر رقم موجود ⇒ +1 بنفس الصيغة", () => {
    expect(nextGroupNumber("GRP-0007")).toBe("GRP-0008");
    expect(nextGroupNumber("GRP-0042")).toBe("GRP-0043");
    expect(nextGroupNumber("GRP-0001")).toBe("GRP-0002");
  });
  test("بلا آخر رقم أو بصيغة تالفة ⇒ GRP-0001", () => {
    expect(nextGroupNumber(null)).toBe("GRP-0001");
    expect(nextGroupNumber(undefined)).toBe("GRP-0001");
    expect(nextGroupNumber("")).toBe("GRP-0001");
    expect(nextGroupNumber("لا يوجد")).toBe("GRP-0001");
  });
  test("العرض أربعة خانات مع حشو الأصفار", () => {
    expect(nextGroupNumber("GRP-0099")).toBe("GRP-0100");
    expect(nextGroupNumber("GRP-9999")).toBe("GRP-10000");
  });
});

describe("dedupeContractIds — إسقاط الفارغ والتكرار مع حفظ الترتيب", () => {
  test("يُبقي أول ظهور لكل معرف ويرتب النتيجة بترتيب الاختيار", () => {
    expect(dedupeContractIds([7, 3, 7, null, 3, undefined, 1])).toEqual([7, 3, 1]);
  });
  test("الفارغ (0/null/undefined) يُسقط كله", () => {
    expect(dedupeContractIds([0, null, undefined])).toEqual([]);
  });
  test("قائمة نظيفة تمر كما هي", () => {
    expect(dedupeContractIds([4, 9, 2])).toEqual([4, 9, 2]);
  });
});

describe("validateGroupContracts — قواعد الضم حرفيًا (_validate_contracts)", () => {
  const pass = {
    ids: [10, 20],
    customerIds: [5, 5],
    statuses: ["نشط", "معتمد"],
  };

  test("اختيار سليم لا يرمي خطأ", () => {
    expect(() => validateGroupContracts(pass)).not.toThrow();
  });

  test("أقل من عقدين ⇒ «اختر عقدين على الأقل للضم في مجموعة واحدة.»", () => {
    expect(() => validateGroupContracts({ ...pass, ids: [10] })).toThrow(
      "اختر عقدين على الأقل للضم في مجموعة واحدة."
    );
    expect(() => validateGroupContracts({ ...pass, ids: [] })).toThrow(
      "اختر عقدين على الأقل للضم في مجموعة واحدة."
    );
  });

  test("معرف غير موجود ضمن الصفوف ⇒ «يوجد عقد غير موجود ضمن الاختيارات.»", () => {
    // ids ثلاثة بينما الصفوف المجلوبة اثنان فقط ⇒ أحدها غير موجود
    expect(() =>
      validateGroupContracts({ ...pass, ids: [10, 20, 30], customerIds: [5, 5], statuses: ["نشط", "معتمد"] })
    ).toThrow("يوجد عقد غير موجود ضمن الاختيارات.");
  });

  test("عملاء مختلفون ⇒ «لا يمكن ضم عقود عملاء مختلفين في نفس المجموعة.»", () => {
    expect(() => validateGroupContracts({ ...pass, customerIds: [5, 6] })).toThrow(
      "لا يمكن ضم عقود عملاء مختلفين في نفس المجموعة."
    );
  });

  test("عقد ملغى ⇒ «لا يمكن ضم عقد ملغى داخل مجموعة جديدة.»", () => {
    expect(() => validateGroupContracts({ ...pass, statuses: ["نشط", "ملغى"] })).toThrow(
      "لا يمكن ضم عقد ملغى داخل مجموعة جديدة."
    );
    expect(() => validateGroupContracts({ ...pass, statuses: ["ملغى", "نشط"] })).toThrow(
      "لا يمكن ضم عقد ملغى داخل مجموعة جديدة."
    );
  });
});

describe("computeGroupTotals — الملخص المالي للمجموعة (مرآة list_groups)", () => {
  const row = (over: Partial<GroupTotalRow> = {}): GroupTotalRow => ({
    status: "نشط",
    current: 0,
    collected: 0,
    paid: 0,
    subs: 0,
    ...over,
  });

  test("المجموعات الأساسية + التكلفة والربح والهامش", () => {
    const t = computeGroupTotals([
      row({ current: 1000, collected: 400, paid: 250, subs: 100 }),
      row({ current: 500, collected: 200, paid: 100, subs: 0 }),
    ]);
    expect(t.currentTotal).toBe(1500);
    expect(t.collectedTotal).toBe(600);
    expect(t.paidTotal).toBe(350);
    expect(t.subsTotal).toBe(100);
    // subs (100) ≤ paid (350) ⇒ التكلفة = المنصرف كما هو
    expect(t.costTotal).toBe(350);
    expect(t.profitTotal).toBe(250);
    expect(t.margin).toBeCloseTo(41.667, 3); // 250/600×100 = 41.666…
  });

  test("باقي التزامات الباطن يدخل التكلفة عندما subs > paid", () => {
    const t = computeGroupTotals([row({ current: 1000, collected: 500, paid: 100, subs: 300 })]);
    // cost = paid + max(0, subs − paid) = 100 + 200 = 300
    expect(t.costTotal).toBe(300);
    expect(t.profitTotal).toBe(200); // 500 − 300
    expect(t.margin).toBe(40);
  });

  test("collected = 0 ⇒ الهامش 0 (قاعدة 0.001)", () => {
    const t = computeGroupTotals([row({ current: 800, collected: 0, paid: 120, subs: 50 })]);
    expect(t.margin).toBe(0);
    expect(t.costTotal).toBe(120); // subs (50) ≤ paid (120) ⇒ التكلفة = المنصرف
    expect(t.profitTotal).toBe(-120);
  });

  test("صفوف الملغى مستثناة كليًا من كل المجاميع", () => {
    const t = computeGroupTotals([
      row({ current: 1000, collected: 400, paid: 250, subs: 100 }),
      row({ status: "ملغى", current: 999, collected: 888, paid: 777, subs: 666 }),
    ]);
    expect(t.currentTotal).toBe(1000);
    expect(t.collectedTotal).toBe(400);
    expect(t.paidTotal).toBe(250);
    expect(t.subsTotal).toBe(100);
  });

  test("كل القيم مدورة r3 (ثلاث خانات)", () => {
    const t = computeGroupTotals([
      row({ current: 100.0004, collected: 33.3333, paid: 10.1111, subs: 5.5555 }),
    ]);
    expect(t.currentTotal).toBe(100);
    expect(t.collectedTotal).toBe(33.333);
    expect(t.paidTotal).toBe(10.111);
    expect(t.subsTotal).toBe(5.556);
    // cost = 10.111 + max(0, 5.556 − 10.111) = 10.111
    expect(t.costTotal).toBe(10.111);
    expect(t.profitTotal).toBe(23.222);
  });

  test("مجموعة فارغة ⇒ أصفار بلا أخطاء", () => {
    const t = computeGroupTotals([]);
    expect(t.currentTotal).toBe(0);
    expect(t.collectedTotal).toBe(0);
    expect(t.costTotal).toBe(0);
    expect(t.profitTotal).toBe(0);
    expect(t.margin).toBe(0);
  });
});
