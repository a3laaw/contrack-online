/**
 * اختبار المرحلة 7-ج — إجراءات مركز العقود + إدارة أنواع العقود
 * قفل المنطق النقي المطابق للمكتبي V9.15.18:
 *   lifecycle_service.py:11    CONTRACT_STATUSES (الترتيب الكامل الثماني)
 *   lifecycle_service.py:230   change_contract_status (مبلغ الإغلاق r3 لا سالب + سطر الحدث)
 *   lifecycle_service.py:199   «تاريخ نهاية العقد يجب أن يكون بعد تاريخ البداية.»
 *   contract_type_service.py:33  MODES (أربع أنماط بترتيبها المكتبي)
 *   contract_type_service.py:113 _validate + _validate_unit + حارس الشامل (الرسائل الحرفية)
 *   contract_hub.py:636        اسم العقد يتبع النوع («غير محدد» يُبقي الاسم الحالي في الويب)
 * الدوال كلها نقية — بلا قاعدة بيانات.
 */

import { describe, expect, test } from "bun:test";
import {
  PRICING_MODES,
  TYPE_ERR_AMOUNT,
  TYPE_ERR_BUNDLE_SUP,
  TYPE_ERR_NAME,
  TYPE_ERR_UNIT_PRICE,
  closeAmountSuffix,
  derivesNameFromType,
  statusOptionsList,
  validateTypeInput,
} from "@/lib/contract-types-admin";

describe("PRICING_MODES — أنماط التسعير الأربعة بترتيب المكتبي (contract_type_service.MODES)", () => {
  test("lump/unit/items/bundle بعناوينها الحرفية", () => {
    expect(PRICING_MODES.map((m) => m.value)).toEqual(["lump", "unit", "items", "bundle"]);
    expect(PRICING_MODES.map((m) => m.label)).toEqual([
      "مبلغ مقطوع",
      "وحدة × سعر",
      "بنود مقابل أسعار",
      "عقد شامل (مكوّنات)",
    ]);
  });
  test("مصدر واحد للحقيقة: الواجهة والخادم يستخدمان نفس القائمة", () => {
    expect(PRICING_MODES).toHaveLength(4);
    expect(new Set(PRICING_MODES.map((m) => m.value)).size).toBe(4);
  });
});

describe("validateTypeInput — حارس النوع برسائل المكتبي الحرفية", () => {
  const valid = { name: "بناء فيلا", defaultAmount: 1500, unitPrice: 0, pricingMode: "lump", isSupervision: false };

  test("نوع سليم ⇒ فراغ (لا خطأ)", () => {
    expect(validateTypeInput(valid)).toBe("");
  });
  test("الاسم مطلوب — فارغ أو أبيض أو غائب ⇒ «اسم نوع العقد مطلوب.»", () => {
    expect(validateTypeInput({ ...valid, name: "" })).toBe(TYPE_ERR_NAME);
    expect(validateTypeInput({ ...valid, name: "   " })).toBe(TYPE_ERR_NAME);
    expect(validateTypeInput({ ...valid, name: undefined })).toBe(TYPE_ERR_NAME);
    expect(TYPE_ERR_NAME).toBe("اسم نوع العقد مطلوب.");
  });
  test("المبلغ السالب مرفوض والصفر مسموح ⇒ «المبلغ لا يمكن أن يكون سالبًا.»", () => {
    expect(validateTypeInput({ ...valid, defaultAmount: -0.001 })).toBe(TYPE_ERR_AMOUNT);
    expect(validateTypeInput({ ...valid, defaultAmount: -500 })).toBe(TYPE_ERR_AMOUNT);
    expect(validateTypeInput({ ...valid, defaultAmount: 0 })).toBe("");
    expect(TYPE_ERR_AMOUNT).toBe("المبلغ لا يمكن أن يكون سالبًا.");
  });
  test("سعر الوحدة السالب مرفوض ⇒ «سعر الوحدة لا يمكن أن يكون سالبًا.»", () => {
    expect(validateTypeInput({ ...valid, unitPrice: -1 })).toBe(TYPE_ERR_UNIT_PRICE);
    expect(validateTypeInput({ ...valid, pricingMode: "unit", unitPrice: -0.5 })).toBe(TYPE_ERR_UNIT_PRICE);
    expect(validateTypeInput({ ...valid, pricingMode: "unit", unitPrice: 250 })).toBe("");
    expect(TYPE_ERR_UNIT_PRICE).toBe("سعر الوحدة لا يمكن أن يكون سالبًا.");
  });
  test("الشامل لا يكون إشرافيًا ⇒ الرسالة الحرفية الكاملة (V3.30)", () => {
    expect(validateTypeInput({ ...valid, pricingMode: "bundle", isSupervision: true })).toBe(TYPE_ERR_BUNDLE_SUP);
    expect(TYPE_ERR_BUNDLE_SUP).toBe("النوع الشامل لا يكون إشرافيًا — أضف الإشراف مكوّنًا بداخله.");
    // شامل غير إشرافي وغير شامل إشرافي ⇒ سليمان
    expect(validateTypeInput({ ...valid, pricingMode: "bundle", isSupervision: false })).toBe("");
    expect(validateTypeInput({ ...valid, pricingMode: "unit", isSupervision: true })).toBe("");
  });
  test("ترتيب الحرس المكتبي: الاسم ← المبلغ ← سعر الوحدة ← الشامل", () => {
    expect(validateTypeInput({ name: "", defaultAmount: -5, unitPrice: -5, pricingMode: "bundle", isSupervision: true })).toBe(TYPE_ERR_NAME);
    expect(validateTypeInput({ ...valid, name: "سليم", defaultAmount: -5, unitPrice: -5, pricingMode: "bundle", isSupervision: true })).toBe(TYPE_ERR_AMOUNT);
    expect(validateTypeInput({ ...valid, defaultAmount: 0, unitPrice: -5, pricingMode: "bundle", isSupervision: true })).toBe(TYPE_ERR_UNIT_PRICE);
  });
});

describe("statusOptionsList — قائمة الحالات الثمانية بترتيب المكتبي (lifecycle:11)", () => {
  test("الترتيب الحرفي: مسودة ← تحت المراجعة ← معتمد ← نشط ← متوقف ← منتهي ← مغلق ← ملغى", () => {
    expect(statusOptionsList).toEqual([
      "مسودة",
      "تحت المراجعة",
      "معتمد",
      "نشط",
      "متوقف",
      "منتهي",
      "مغلق",
      "ملغى",
    ]);
  });
  test("ثماني حالات بلا تكرار — تشمل مسودة/تحت المراجعة/معتمد الغائبين عن القائمة القديمة", () => {
    expect(statusOptionsList).toHaveLength(8);
    expect(new Set(statusOptionsList).size).toBe(8);
  });
});

describe("derivesNameFromType — اسم العقد يتبع النوع (contract_hub.py:636)", () => {
  test("اسم نوع حقيقي ⇒ هو الاسم (مقصوصًا من الأطراف)", () => {
    expect(derivesNameFromType("بناء فيلا", "الاسم القديم")).toBe("بناء فيلا");
    expect(derivesNameFromType("  صيانة سنوية  ", "الاسم القديم")).toBe("صيانة سنوية");
  });
  test("بلا نوع أو «غير محدد» ⇒ يُبقى الاسم الحالي للعقد (سلوك الويب المعتمد)", () => {
    expect(derivesNameFromType("", "الاسم القديم")).toBe("الاسم القديم");
    expect(derivesNameFromType("غير محدد", "الاسم القديم")).toBe("الاسم القديم");
    expect(derivesNameFromType("   ", "عقد بلا اسم")).toBe("عقد بلا اسم");
  });
  test("اسم العقد = اسم النوع دائمًا (المصدر الوحيد للحقيقة)", () => {
    expect(derivesNameFromType("نوع جديد", "نوع جديد")).toBe("نوع جديد");
  });
});

describe("closeAmountSuffix — سطر مبلغ الإغلاق في وصف الحدث (lifecycle:270)", () => {
  test("أكبر من صفر ⇒ « · مبلغ الإغلاق: X د.ك» بالتنسيق المكتبي 3 منازل وفواصل", () => {
    expect(closeAmountSuffix(1500)).toBe(" · مبلغ الإغلاق: 1,500.000 د.ك");
    expect(closeAmountSuffix(12.5)).toBe(" · مبلغ الإغلاق: 12.500 د.ك");
    expect(closeAmountSuffix(0.125)).toBe(" · مبلغ الإغلاق: 0.125 د.ك");
  });
  test("صفر أو غائب ⇒ نص فارغ (لا سطر بلا مبلغ)", () => {
    expect(closeAmountSuffix(0)).toBe("");
    expect(closeAmountSuffix(-3)).toBe("");
  });
});
