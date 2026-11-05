/**
 * اختبارات قواعد ترحيل السندات — Task 106.
 * الغلاف: الكتالوج (تغطية أصناف السندات) + حسم مفتاح القاعدة من سياق السند
 * + سلسلة أولويات الطرف (صريح → قاعدة → مدمج) + تحقق إدخال الإعدادات
 * + مرآة الافتراضي المدمج لمنطق Task 105 — كلها دوال نقية بلا قاعدة بيانات.
 */
import { describe, expect, test } from "bun:test";
import {
  builtinCashAccountForMethod,
  builtinCreditName,
  builtinDebitName,
  checkPostingRuleUpdate,
  POSTING_RULE_BY_KEY,
  POSTING_RULE_CATALOG,
  resolvePostingSide,
  resolveRuleKeyForVoucher,
  resolveSeedableCode,
  type RuleChartAccount,
  type SeedChartAccount,
} from "../src/lib/posting-rules-core";

/** دليل مصغّر للاختبار — أكواد البذرة القياسية */
const CHART: RuleChartAccount[] = [
  { id: 1, code: "1111", name: "الصندوق", allowPosting: true, isActive: true },
  { id: 2, code: "1112", name: "البنك — الحساب الجاري", allowPosting: true, isActive: true },
  { id: 3, code: "1121", name: "العملاء", allowPosting: true, isActive: true },
  { id: 4, code: "1140", name: "عُهد وسلف الموظفين", allowPosting: true, isActive: true },
  { id: 5, code: "4100", name: "إيرادات العقود", allowPosting: true, isActive: true },
  { id: 6, code: "5210", name: "رواتب وأجور", allowPosting: true, isActive: true },
  { id: 7, code: "5260", name: "رسوم وعمولات بنكية", allowPosting: true, isActive: true },
  { id: 8, code: "5300", name: "مصروفات أخرى", allowPosting: true, isActive: true },
  { id: 11, code: "5120", name: "عمالة ومقاولو باطن", allowPosting: true, isActive: true },
  { id: 9, code: "1100", name: "الأصول المتداولة", allowPosting: false, isActive: true }, // إجمالية
  { id: 10, code: "1150", name: "دفعات مقدمة معطلة", allowPosting: true, isActive: false }, // معطلة
];

describe("POSTING_RULE_CATALOG — كتالوج الأصناف (قرار الخطة: 8 أصناف + مستندات النظام)", () => {
  test("كل الأصناف المطلوبة في الخطة موجودة بمفاتيح فريدة", () => {
    const keys = POSTING_RULE_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const required of [
      "receipt", // قبض
      "payment_expense", // صرف مصروف
      "payment_contract_due", // صرف استحقاق عقد
      "payment_subcontract", // صرف باطن
      "custody_handover", // عهدة (تسليم)
      "custody_return", // إرجاع عهدة
      "salary_deduction", // خصم راتب
      "bank_fee", // رسوم بوابة
    ]) {
      expect(keys).toContain(required);
    }
  });

  test("البذرة الافتراضية: خصم الراتب ورسوم البوابة مثبتا الحساب، والبقية سياقية", () => {
    expect(POSTING_RULE_BY_KEY.get("salary_deduction")?.defaultDebitCode).toBe("5210");
    expect(POSTING_RULE_BY_KEY.get("salary_deduction")?.defaultCreditCode).toBe("1140");
    expect(POSTING_RULE_BY_KEY.get("bank_fee")?.defaultDebitCode).toBe("5260");
    expect(POSTING_RULE_BY_KEY.get("receipt")?.defaultDebitCode).toBe("");
    expect(POSTING_RULE_BY_KEY.get("payment_expense")?.defaultDebitCode).toBe("");
  });

  test("أطراف العهد والتحويل غير قابلة للتثبيت (سياقية دائمًا من السند)", () => {
    for (const key of ["custody_handover", "custody_return", "transfer"]) {
      const def = POSTING_RULE_BY_KEY.get(key)!;
      expect(def.debitAdjustable).toBe(false);
      expect(def.creditAdjustable).toBe(false);
    }
  });
});

describe("resolveRuleKeyForVoucher — مفتاح القاعدة من سياق السند", () => {
  test("الأنواع المستقلة تُحسم مباشرة", () => {
    expect(resolveRuleKeyForVoucher({ vtype: "receipt" })).toBe("receipt");
    expect(resolveRuleKeyForVoucher({ vtype: "custody_return" })).toBe("custody_return");
    expect(resolveRuleKeyForVoucher({ vtype: "salary_deduction" })).toBe("salary_deduction");
    expect(resolveRuleKeyForVoucher({ vtype: "transfer" })).toBe("transfer");
  });

  test("الصرف يتفرع: شريك ← تصفية عهدة ← تسليم عهدة ← باطن ← استحقاق عقد ← مصروف", () => {
    expect(resolveRuleKeyForVoucher({ vtype: "payment", partyType: "partner" })).toBe("payment_partner");
    expect(resolveRuleKeyForVoucher({ vtype: "payment", hasCustodyAccountId: true, hasAccountId: true })).toBe("custody_settlement");
    expect(resolveRuleKeyForVoucher({ vtype: "payment", hasCustodyAccountId: true })).toBe("custody_handover");
    expect(resolveRuleKeyForVoucher({ vtype: "payment", hasSubContractId: true })).toBe("payment_subcontract");
    expect(resolveRuleKeyForVoucher({ vtype: "payment", hasContractId: true })).toBe("payment_contract_due");
    expect(resolveRuleKeyForVoucher({ vtype: "payment" })).toBe("payment_expense");
  });

  test("الباطن يتقدم على استحقاق العقد (أدق سياقًا) والشريك يتقدم على العهدة", () => {
    expect(resolveRuleKeyForVoucher({ vtype: "payment", hasSubContractId: true, hasContractId: true })).toBe("payment_subcontract");
    expect(resolveRuleKeyForVoucher({ vtype: "payment", partyType: "partner", hasCustodyAccountId: true })).toBe("payment_partner");
  });

  test("نوع غير معروف ⇒ مفتاح فارغ (بلا قيد كما كان)", () => {
    expect(resolveRuleKeyForVoucher({ vtype: "whatever" })).toBe("");
  });
});

describe("resolvePostingSide — سلسلة الأولويات الصارمة", () => {
  test("الاختيار الصريح للسند يتقدم على كود القاعدة والاسم المدمج", () => {
    const res = resolvePostingSide(
      { explicitAccountId: 8, ruleCode: "5210", builtinName: "رواتب" },
      CHART
    );
    expect(res?.accountId).toBe(8);
    expect(res?.source).toBe("explicit");
    expect(res?.name).toBe("مصروفات أخرى");
  });

  test("كود القاعدة يتقدم على الاسم المدمج عند غياب الصريح", () => {
    const res = resolvePostingSide({ explicitAccountId: null, ruleCode: "5260", builtinName: "مصروفات أخرى" }, CHART);
    expect(res?.accountId).toBe(7);
    expect(res?.source).toBe("rule");
  });

  test("كود فارغ أو غير موجود في الدليل ⇒ الاسم المدمج يُحسم نصيًا (بلا id)", () => {
    expect(resolvePostingSide({ ruleCode: "", builtinName: "الصندوق" }, CHART)).toEqual({
      accountId: null,
      source: "builtin",
      name: "الصندوق",
    });
    expect(resolvePostingSide({ ruleCode: "9999", builtinName: "الصندوق" }, CHART)?.source).toBe("builtin");
  });

  test("الصريح المحسوم إلى حساب إجمالي أو معطل يُتجاهل ويسقط للطبقة التالية", () => {
    expect(resolvePostingSide({ explicitAccountId: 9, ruleCode: "", builtinName: "الصندوق" }, CHART)?.source).toBe("builtin");
    expect(resolvePostingSide({ explicitAccountId: 10, ruleCode: "", builtinName: "الصندوق" }, CHART)?.source).toBe("builtin");
  });

  test("بلا أي مادة حسم ⇒ null (الخادم يمرر للتسوية عبر الحاسم النصي)", () => {
    expect(resolvePostingSide({ explicitAccountId: null, ruleCode: "", builtinName: "" }, CHART)).toBeNull();
  });
});

describe("الافتراضي المدمج — مرآة منطق Task 105 حرفيًا", () => {
  test("مدين القبض: نص الحساب ثم طريقة الدفع (نقد/بنك)", () => {
    expect(builtinDebitName("receipt", { method: "نقدًا", account: "", snapshot: "", partyType: "" })).toBe("صندوق");
    expect(builtinDebitName("receipt", { method: "حوالة بنكية", account: "", snapshot: "", partyType: "" })).toBe("بنك");
    expect(builtinDebitName("receipt", { method: "نقدًا", account: "شيكات", snapshot: "", partyType: "" })).toBe("شيكات");
  });

  test("مدين الصرف: الاسم المسجل ثم جاري الشريك ثم مصروفات أخرى", () => {
    expect(builtinDebitName("payment", { method: "", account: "", snapshot: "صيانة ووقود", partyType: "" })).toBe("صيانة ووقود");
    expect(builtinDebitName("payment", { method: "", account: "", snapshot: "", partyType: "partner" })).toBe("جاري الشريك");
    expect(builtinDebitName("payment", { method: "", account: "", snapshot: "", partyType: "" })).toBe("مصروفات أخرى");
  });

  test("دائن القبض بعقد: إيرادات العقود، وبلا عقد: العملاء", () => {
    expect(builtinCreditName("receipt", { method: "", account: "", snapshot: "", partyType: "", hasContractId: true })).toBe("إيرادات العقود");
    expect(builtinCreditName("receipt", { method: "", account: "", snapshot: "", partyType: "", hasContractId: false })).toBe("العملاء");
  });

  test("التحويل من نص السند: المدين المستلَم والدائن المُحوَّل منه", () => {
    expect(builtinDebitName("transfer", { method: "صندوق", account: "بنك", snapshot: "", partyType: "" })).toBe("بنك");
    expect(builtinCreditName("transfer", { method: "صندوق", account: "بنك", snapshot: "", partyType: "" })).toBe("صندوق");
  });

  test("إرجاع العهدة: مدين النقد ودائن اسم العهدة المسجل", () => {
    expect(builtinDebitName("custody_return", { method: "نقدًا", account: "", snapshot: "عهدة أحمد", partyType: "" })).toBe("صندوق");
    expect(builtinCreditName("custody_return", { method: "نقدًا", account: "", snapshot: "عهدة أحمد", partyType: "" })).toBe("عهدة أحمد");
  });

  test("خصم الراتب ثابت: رواتب مقابل سلف موظفين", () => {
    expect(builtinDebitName("salary_deduction", { method: "", account: "", snapshot: "", partyType: "" })).toBe("رواتب");
    expect(builtinCreditName("salary_deduction", { method: "", account: "", snapshot: "", partyType: "" })).toBe("سلف موظفين");
  });

  test("حاسم طريقة الدفع النقدي يطابق defaultAccountForMethod (بنك/كي نت/حوالة)", () => {
    for (const m of ["بنك", "حوالة بنكية", "تحويل", "KNET", "knet", "Bank Transfer"]) {
      expect(builtinCashAccountForMethod(m)).toBe("بنك");
    }
    expect(builtinCashAccountForMethod("نقدًا")).toBe("صندوق");
    expect(builtinCashAccountForMethod("شيك")).toBe("صندوق");
  });
});

describe("resolveSeedableCode — بذرة الكود القابل للنشر (درس دمج 105: 1140→114001)", () => {
  const seedChart: SeedChartAccount[] = [
    { code: "1111", isLeaf: true, allowPosting: true, isActive: true },
    { code: "1140", isLeaf: false, allowPosting: false, isActive: true }, // صار إجماليًا
    { code: "114001", isLeaf: true, allowPosting: true, isActive: true }, // ورقة الترحيل
    { code: "5210", isLeaf: true, allowPosting: true, isActive: true },
    { code: "5300", isLeaf: false, allowPosting: false, isActive: true },
    { code: "530001", isLeaf: true, allowPosting: true, isActive: true },
    { code: "1150", isLeaf: true, allowPosting: true, isActive: false }, // معطلة
  ];

  test("الأزرق ورقة نشطة تقبل النشر ⇒ يبقى كما هو", () => {
    expect(resolveSeedableCode("5210", seedChart)).toBe("5210");
    expect(resolveSeedableCode("1111", seedChart)).toBe("1111");
  });

  test("الأزرق صار إجماليًا ⇒ أعمق ورقة ابن تقبل النشر (1140→114001، 5300→530001)", () => {
    expect(resolveSeedableCode("1140", seedChart)).toBe("114001");
    expect(resolveSeedableCode("5300", seedChart)).toBe("530001");
  });

  test("لا ذرية قابلة للنشر (أو معطلة) ⇒ فارغ سياقي بلا تثبيت فاشل", () => {
    expect(resolveSeedableCode("1150", seedChart)).toBe(""); // الورقة الوحيدة معطلة
    expect(resolveSeedableCode("9999", seedChart)).toBe("");
    expect(resolveSeedableCode("", seedChart)).toBe("");
  });
});

describe("checkPostingRuleUpdate — تحقق إدخال شاشة الإعدادات", () => {
  const codes = new Set(CHART.map((a) => a.code));

  test("قاعدة معروفة بكود صحيح تقبل", () => {
    const res = checkPostingRuleUpdate({ ruleKey: "payment_subcontract", debitCode: "5120", enabled: true }, POSTING_RULE_BY_KEY.get("payment_subcontract"), codes);
    expect(res.ok).toBe(true);
    expect(res.debitCode).toBe("5120");
  });

  test("كود غير موجود في الدليل يُرفض برسالة عربية", () => {
    const res = checkPostingRuleUpdate({ ruleKey: "payment_expense", debitCode: "9800" }, POSTING_RULE_BY_KEY.get("payment_expense"), codes);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("غير موجود في دليل الحسابات");
  });

  test("القاعدة غير القابلة للتثبيت ترفض الكود (العهد سياقية دائمًا)", () => {
    const res = checkPostingRuleUpdate({ ruleKey: "custody_handover", debitCode: "1111" }, POSTING_RULE_BY_KEY.get("custody_handover"), codes);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("لا يمكن تثبيت");
  });

  test("مفتاح مجهول يُرفض والكود الفارغ يُقبل (سياقي)", () => {
    expect(checkPostingRuleUpdate({ ruleKey: "hack" }, POSTING_RULE_BY_KEY.get("hack"), codes).ok).toBe(false);
    const empty = checkPostingRuleUpdate({ ruleKey: "receipt", debitCode: "", creditCode: "" }, POSTING_RULE_BY_KEY.get("receipt"), codes);
    expect(empty.ok).toBe(true);
    expect(empty.debitCode).toBe("");
  });

  test("التفعيل يقبل true/«true»/1 ويرجع افتراضيًا true عند غيابه", () => {
    expect(checkPostingRuleUpdate({ ruleKey: "bank_fee", enabled: "true" }, POSTING_RULE_BY_KEY.get("bank_fee"), codes).enabled).toBe(true);
    expect(checkPostingRuleUpdate({ ruleKey: "bank_fee", enabled: 1 }, POSTING_RULE_BY_KEY.get("bank_fee"), codes).enabled).toBe(true);
    expect(checkPostingRuleUpdate({ ruleKey: "bank_fee", enabled: false }, POSTING_RULE_BY_KEY.get("bank_fee"), codes).enabled).toBe(false);
    expect(checkPostingRuleUpdate({ ruleKey: "bank_fee" }, POSTING_RULE_BY_KEY.get("bank_fee"), codes).enabled).toBe(true);
  });
});
