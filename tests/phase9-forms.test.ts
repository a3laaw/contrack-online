/**
 * اختبار المرحلة 9 — مركز النماذج Word (بند 56)
 * المرجع المكتبي (قراءة فقط):
 *   form_service.py:39        TEMPLATE_STATUSES («مسودة/معتمد/معطل/مؤرشف»)
 *   :46-49                    SOURCE_TYPES · :40-45 FIELD_TYPES
 *   :163-216                  DATA_SOURCES بالتسميات العربية الحرفية
 *   :429-465                  scan_word_placeholders (النص الظاهر w:t داخل w:p)
 *   :60-71/804-823            _resolve_contract/_field_text (مبلغ بثلاث خانات · افتراضي · عنوان)
 *   :533-549                  _calc_value ({a}+{b} بحاصرة آمنة)
 *   :1025-1028                _next_doc_number → FD-%04d
 *   :1076                     اسم الأرشفة safe_num.docx (تنظيف \\/:*?"<>| وقص 50)
 *   word_forms_service.py:17-83/86-142   _norm/SYNONYMS/guess_field
 *   :152-157                  «تم رفع القالب. الحقول: n · مطابق تلقائيًا: m»
 *   word_forms_center.py:1452  «…لن يتم حذف أي مستندات عملاء لأنه غير مستخدم.»
 * انحرافات الويب الموثقة (worklog 56): مصدر financial حُوّط لقيمة العقد
 * كيانياً · التخزين base64 ببروتوكول "base64:" داخل wordPath · Word فقط بلا PDF.
 * القوالب الثنائية بالاختبارات تُولَّد برمجيًا (pizzip) — لا ملفات docx بالمستودع.
 */

import { describe, expect, test } from "bun:test";
import {
  analyzeFields,
  arabicWeekday,
  addressPlaceholderKey,
  buildFieldMapping,
  calcValue,
  docFileName,
  extractPlaceholderNames,
  fieldText,
  fieldsColumnText,
  formDocNumber,
  guessField,
  missingRequiredManual,
  normPlaceholder,
  resolveContractKey,
  resolveQuotationKey,
  resolveSystemKey,
  safeArithmetic,
  sortTemplates,
  TEMPLATE_STATUSES,
  templateStatusBadgeClass,
  B64_PREFIX,
  FIELD_TYPES,
  SOURCE_TYPES,
  MSG_TEMPLATE_BAD_STATUS,
  MSG_TEMPLATE_NAME_REQUIRED,
  MSG_TEMPLATE_DUP_IMPORT,
  MSG_TEMPLATE_DUP_UPDATE,
  MSG_DELETE_USED,
  MSG_CORRUPT_DOCX,
  MSG_CHOOSE_DOCX,
  MSG_FIELD_REQUIRED_PREFIX,
  MSG_UPLOAD_SUCCESS_PREFIX,
} from "@/lib/forms/forms-core";
import {
  buildTemplateDocx,
  docxParagraphTexts,
  renderTemplateDocx,
  scanTemplateFields,
  xmlParagraphTexts,
} from "@/lib/forms/docx";

// ============================================================
// 1) استخراج الوسوم من نص XML (مرآة scan_word_placeholders)
// ============================================================

describe("استخراج وسوم {{...}} من XML الظاهر (form_service.py:429-465)", () => {
  test("يجمع النص المقطع على runs ويوسم داخل فقرة واحدة ثم يستخرج", () => {
    // وسم مقطوع بين ثلاثة w:t مع وسوم rPr/proofErr بينها — حالة الوورد الفعلية
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>عقد بين الشركة و</w:t></w:r>' +
      '<w:r><w:rPr/></w:r><w:proofErr w:type="spellStart"/>' +
      '<w:r><w:t>{{اسم_</w:t></w:r><w:r><w:t>العميل}}</w:t></w:r>' +
      '</w:p>' +
      '<w:p><w:r><w:t>رقم العقد: </w:t></w:r><w:r><w:t>{{رقم_العقد}}</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const chunks = xmlParagraphTexts(xml);
    expect(chunks).toEqual(["عقد بين الشركة و{{اسم_العميل}}", "رقم العقد: {{رقم_العقد}}"]);
    expect(extractPlaceholderNames(chunks.join("\n"))).toEqual(["اسم_العميل", "رقم_العقد"]);
  });

  test("يطبع الفراغات المتعددة ويتجاهل المكرر والحاويات لوسوم XML", () => {
    const text = "{{  اسم   العميل }} و{{اسم العميل}} و{{}} و{{a<b}} و{{سليم}}";
    expect(extractPlaceholderNames(text)).toEqual(["اسم العميل", "سليم"]);
  });

  test("لا يلتقط ما بين الفقرات — كل فقرة نص مستقل (لا XML الخام)", () => {
    const xml =
      "<w:p><w:r><w:t>{{بداية</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>نهاية}}</w:t></w:r></w:p>";
    expect(extractPlaceholderNames(xmlParagraphTexts(xml).join("\n"))).toEqual([]);
  });
});

// ============================================================
// 2) قلب المحرك كاملاً: docx برمجي ⇒ استخراج ⇒ توليد (pizzip/docxtemplater)
// ============================================================

describe("محرك docx — قالب مولد برمجيًا (بلا ملفات ثنائية بالمستودع)", () => {
  const tpl = buildTemplateDocx([
    "عقد بين الشركة و{{اسم_العميل}} بمبلغ {{قيمة العقد}}",
    "رقم العقد {{رقم_العقد}} بتاريخ {{التاريخ}}",
    "الرخصة {{رقم_الرخصة}} ووسم غائب {{وسم_غائب}}",
  ]);

  test("الملف المولد docx صحيح (PK) والوسوم تُستخرج وتُخمَّن مصادرها", () => {
    expect(tpl[0]).toBe(0x50);
    expect(tpl[1]).toBe(0x4b);
    const fields = scanTemplateFields(tpl);
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get("اسم_العميل")).toMatchObject({
      sourceType: "system", sourceEntity: "customers", sourceKey: "name", known: true,
    });
    expect(byName.get("رقم_العقد")).toMatchObject({
      sourceType: "system", sourceEntity: "contracts", sourceKey: "contract_number",
    });
    expect(byName.get("التاريخ")).toMatchObject({
      sourceType: "auto", sourceEntity: "system", sourceKey: "today", fieldType: "date",
    });
    // وسم بفراغ داخلي: قيمة العقد ⇒ يدوي مالي إلزامي (مرآة guess_field)
    expect(byName.get("قيمة العقد")).toMatchObject({
      sourceType: "manual", fieldType: "money", required: true, known: true,
    });
    expect(byName.get("وسم_غائب")).toMatchObject({ sourceType: "manual", known: false });
  });

  test("التوليد: القيم تدخل الوسوم والوسم غير المربوط يبقى نصًا كما هو (سلوك المكتبي)", () => {
    const out = renderTemplateDocx(tpl, {
      data: {
        "اسم_العميل": "شركة الأفق للمقاولات",
        "قيمة العقد": "1,200.250 د.ك",
        "رقم_العقد": "CT-0014",
        "التاريخ": "2026-10-20",
      },
    });
    expect(out[0]).toBe(0x50);
    expect(out[1]).toBe(0x4b);
    const text = docxParagraphTexts(out).join("\n");
    expect(text).toContain("شركة الأفق للمقاولات");
    expect(text).toContain("1,200.250 د.ك");
    expect(text).toContain("CT-0014");
    expect(text).toContain("2026-10-20");
    // رقم الرخصة بلا قيمة ⇒ nullGetter يعيده نصًا كالمكتبي (استبدال المربوط فقط)
    expect(text).toContain("{{رقم_الرخصة}}");
    expect(text).toContain("{{وسم_غائب}}");
  });

  test("قيمة يدوية متعددة الأسطر تنزل سطورًا داخل المستند (linebreaks)", () => {
    const tpl2 = buildTemplateDocx(["بنود:\n{{جدول_البنود}}"]);
    const out = renderTemplateDocx(tpl2, { data: { "جدول_البنود": "بند أول\nبند ثانٍ" } });
    const text = docxParagraphTexts(out).join("\n");
    expect(text).toContain("بند أول");
    expect(text).toContain("بند ثانٍ");
  });
});

// ============================================================
// 3) تخمين المصادر (guess_field) ومرادفات الويب
// ============================================================

describe("guessField — مرآة word_forms_service.guess_field مع حوطة الويب", () => {
  test("مرادفات العملاء والعقود والنظام الحرفية", () => {
    expect(guessField("اسم_العميل")).toMatchObject({ sourceType: "system", sourceEntity: "customers", sourceKey: "name", context: "customer" });
    expect(guessField("هاتف_العميل")).toMatchObject({ sourceEntity: "customers", sourceKey: "phone" });
    expect(guessField("المحافظة")).toMatchObject({ sourceEntity: "customers", sourceKey: "address_governorate" });
    expect(guessField("اسم المالك")).toMatchObject({ sourceEntity: "customers", sourceKey: "name" });
    expect(guessField("رقم_العقد")).toMatchObject({ sourceEntity: "contracts", sourceKey: "contract_number" });
    expect(guessField("بيان_العقد")).toMatchObject({ sourceEntity: "contracts", sourceKey: "contract_name" });
    expect(guessField("مدة التنفيذ")).toMatchObject({ sourceEntity: "contracts", sourceKey: "duration_days" });
    expect(guessField("تاريخ_اليوم")).toMatchObject({ sourceType: "auto", sourceEntity: "system", sourceKey: "today" });
    expect(guessField("السنة")).toMatchObject({ sourceEntity: "system", sourceKey: "year" });
    expect(guessField("اسم_المستخدم")).toMatchObject({ sourceEntity: "system", sourceKey: "user" });
    // عروض الأسعار — كيان الويب (بند 12)
    expect(guessField("رقم_عرض_السعر")).toMatchObject({ sourceEntity: "quotations", sourceKey: "quotation_number", context: "quotation" });
  });

  test("مالية العقد المكتبية حرفياً: قيمة/مبلغ العقد ⇒ يدوي مالي إلزامي (word_forms_service.py:97-114)", () => {
    for (const ph of ["قيمة_العقد", "مبلغ_العقد"]) {
      expect(guessField(ph)).toMatchObject({ sourceType: "manual", fieldType: "money", required: true, known: true });
    }
    // «المبلغ» و«الاجمالي» بالمكتبي ضمن مجموعة الإجماليات المحسوبة — والويب بلا مجموعة
    // الإجماليات (انحراف موثق «بلا حسابات الدفعات/الإجمالي») ⇒ يدوي غير معروف
    expect(guessField("المبلغ")).toMatchObject({ sourceType: "manual", known: false });
    expect(guessField("الاجمالي")).toMatchObject({ sourceType: "manual", known: false });
    // واقعة التطبيع كالمكتبي _norm (بلا إزالة حركات): أ/إ/آ⇒ا وة⇒ه
    expect(normPlaceholder("قيمة_العقد")).toBe("قيمه_العقد");
    expect(normPlaceholder("أجمالي-العقد")).toBe("اجمالي_العقد");
  });

  test("بقية الوسوم المالية وغير المعروفة تبقى إدخال يدوي", () => {
    expect(guessField("المحصل")).toMatchObject({ sourceType: "manual", known: false });
    expect(guessField("المتبقي")).toMatchObject({ sourceType: "manual", known: false });
    expect(guessField("خانة_حرة_أيها")).toMatchObject({ sourceType: "manual", known: false });
  });

  test("عائلة قيمة العقد اليدوية المالية الإلزامية وكتابتها محسوبة كالمكتبي", () => {
    expect(guessField("اجمالي_العقد")).toMatchObject({ sourceType: "manual", fieldType: "money", required: true });
    expect(guessField("قيمة_العقد_كتابة")).toMatchObject({ sourceType: "calc", fieldType: "text", required: false });
    expect(guessField("دفعة_1_قيمة")).toMatchObject({ sourceType: "manual", fieldType: "money", required: false });
    expect(guessField("الدفعة_2_كتابة")).toMatchObject({ sourceType: "calc" });
    expect(guessField("دفعة_3_نسبة")).toMatchObject({ sourceType: "manual", fieldType: "text" });
  });
});

// ============================================================
// 4) دمج القيم: يدوي + مصادر وهمية (مرآة _field_text/build_context)
// ============================================================

const CTX = {
  customer: {
    name: "شركة الأفق للمقاولات",
    customer_code: "C-0014",
    phone: "5550001",
    address: "حولي - شارع الخرطوم",
    address_governorate: "حولي",
    address_area: "السالمية",
    address_block: "5",
    address_plot: "12",
    email: "info@ofoq.test",
  },
  contract: {
    contract_number: "CT-0014",
    contract_name: "صيانة سنوية",
    contract_type: "صيانة",
    amount: "1200.25",
    contract_date: "2026-01-15",
    duration_days: "180",
    customer_name: "شركة الأفق للمقاولات",
    description: "بيان العقد حرفيًا",
  },
  quotation: {
    quotationNumber: "QUO-0001",
    status: "جديد",
    validUntil: "2026-11-30",
    totalAmount: "1200.25",
    notes: "ملاحظات العرض",
    customer_name: "شركة الأفق للمقاولات",
    project_name: "مشروع التجربة",
    items: [
      { description: "تكييف مركزي", unit: "عدد", quantity: "2", unitPrice: "450.125", totalPrice: "900.25" },
      { description: "دهانات", unit: "", quantity: "3", unitPrice: "100", totalPrice: "300" },
    ],
  },
  settings: { companyName: "شركة النماذج", companyPhone: "1888000", companyAddress: "العاصمة", currency: "د.ك" },
  now: new Date("2026-10-20T12:00:00"),
  user: "zt56a",
};

describe("دمج القيم اليدوية ومصادر النظام (مرآة fill_word)", () => {
  test("الحقل النظامي يُحل من سياق العميل بالأسماء المكتبية", () => {
    const text = fieldText(
      { name: "x", sourceType: "system", sourceEntity: "customers", sourceKey: "name" },
      {},
      CTX
    );
    expect(text).toBe("شركة الأفق للمقاولات");
  });

  test("حقل العقد: قيمة العقد بثلاث خانات وفواصل واسم العميل من عقده", () => {
    expect(resolveContractKey(CTX, "amount")).toBe("1,200.250");
    expect(resolveContractKey(CTX, "customer_name")).toBe("شركة الأفق للمقاولات");
    expect(resolveContractKey(CTX, "contract_number")).toBe("CT-0014");
  });

  test("اليدوي يتقدم على الافتراضي والافتراضي يتقدم على الفراغ (مرآة _field_text)", () => {
    const field = { name: "ملاحظة_حرة", placeholder: "ملاحظة_حرة", sourceType: "manual", defaultValue: "افتراضي" };
    expect(fieldText(field, { "ملاحظة_حرة": "مدخل" }, CTX)).toBe("مدخل");
    expect(fieldText(field, {}, CTX)).toBe("افتراضي");
  });

  test("المبلغ اليدوي يُنسق بثلاث خانات مع العملة، وغير الرقم يبقى كما هو", () => {
    const money = { name: "م", fieldType: "money", sourceType: "manual" };
    expect(fieldText(money, { "م": "1200.25" }, CTX, "د.ك")).toBe("1,200.250 د.ك");
    expect(fieldText(money, { "م": "نص" }, CTX, "د.ك")).toBe("نص");
  });

  test("وسوم العناوين الفاضية تستكمل من العميل (مرآة _address_placeholder_key)", () => {
    expect(addressPlaceholderKey("المحافظة")).toBe("address_governorate");
    expect(addressPlaceholderKey("قطعة العميل")).toBe("address_block");
    const empty = { name: "المحافظة", placeholder: "المحافظة", sourceType: "manual" };
    expect(fieldText(empty, {}, CTX)).toBe("حولي");
  });

  test("بيانات الشركة والقيم التلقائية (مرآة _resolve_system/resolve_setting)", () => {
    const mapping = buildFieldMapping(
      [
        { name: "اسم_الشركة", placeholder: "اسم_الشركة", sourceType: "system", sourceEntity: "settings", sourceKey: "company_name" },
        { name: "العملة", placeholder: "العملة", sourceType: "system", sourceEntity: "settings", sourceKey: "currency" },
        { name: "اليوم", placeholder: "اليوم", sourceType: "auto", sourceEntity: "system", sourceKey: "today" },
        { name: "اسم_المستخدم", placeholder: "اسم_المستخدم", sourceType: "auto", sourceEntity: "system", sourceKey: "user" },
      ],
      {},
      CTX
    );
    expect(mapping["اسم_الشركة"]).toBe("شركة النماذج");
    expect(mapping["العملة"]).toBe("د.ك");
    expect(mapping["اليوم"]).toBe("2026-10-20");
    expect(mapping["اسم_المستخدم"]).toBe("zt56a");
    // ترتيب الأيام المكتبية: الاثنين أولاً (weekday() لا getDay())
    const sunday = new Date("2026-10-18T12:00:00");
    expect(arabicWeekday(sunday)).toBe("الأحد");
    expect(resolveSystemKey("today", { now: sunday })).toBe("2026-10-18");
  });

  test("عرض السعر: الرقم والحالة والإجمالي بثلاث خانات وجدول البنود بأسطر المكتبي", () => {
    expect(resolveQuotationKey(CTX, "quotation_number")).toBe("QUO-0001");
    expect(resolveQuotationKey(CTX, "status")).toBe("جديد");
    expect(resolveQuotationKey(CTX, "total")).toBe("1,200.250");
    const items = resolveQuotationKey(CTX, "items_table");
    expect(items).toContain("- تكييف مركزي: 2.000 عدد × 450.125 = 900.250 د.ك");
    expect(items).toContain("- دهانات: 3.000  × 100.000 = 300.000 د.ك");
  });

  test("buildFieldMapping يغطي كل الحقول بمفاتيح الوسوم", () => {
    const mapping = buildFieldMapping(
      [
        { name: "اسم_العميل", placeholder: "اسم_العميل", sourceType: "system", sourceEntity: "customers", sourceKey: "name" },
        { name: "م", placeholder: "م", sourceType: "manual", fieldType: "money" },
      ],
      { "م": "5" },
      CTX
    );
    expect(Object.keys(mapping).sort()).toEqual(["اسم_العميل", "م"]);
    expect(mapping["م"]).toBe("5.000 د.ك");
  });

  test("missingRequiredManual — الإلزام على اليدوي فقط (مرآة فحص نافذة التعبئة)", () => {
    const fields = [
      { name: "أ", placeholder: "أ", sourceType: "manual", required: true },
      { name: "ب", placeholder: "ب", sourceType: "system", sourceEntity: "customers", sourceKey: "name", required: true },
      { name: "ج", placeholder: "ج", sourceType: "manual", required: false },
    ];
    expect(missingRequiredManual(fields, {})).toEqual(["أ"]);
    expect(missingRequiredManual(fields, { "أ": " " })).toEqual(["أ"]);
    expect(missingRequiredManual(fields, { "أ": "قيمة" })).toEqual([]);
    expect(MSG_FIELD_REQUIRED_PREFIX).toBe("الحقل مطلوب: ");
  });
});

// ============================================================
// 5) القيمة المحسوبة (مرآة _calc_value)
// ============================================================

describe("calcValue — تقييم آمن بلا eval", () => {
  test("الاستبدال داخل الأقواس ثم الحساب", () => {
    expect(calcValue("{المبلغ} + {الشحن}", { "المبلغ": "10", "الشحن": "2.5" })).toBe("12.500");
  });
  test("الأقواس والعمليات والحارس على غير الأرقام", () => {
    expect(safeArithmetic("(2+3)*4")).toBe(20);
    expect(safeArithmetic("10/4")).toBe(2.5);
    expect(safeArithmetic("1/0")).toBeNull();
    expect(safeArithmetic("2+"))    .toBeNull();
    expect(calcValue("import os", {})).toBe("");
    expect(calcValue("{غير رقم}", {})).toBe("");
  });
});

// ============================================================
// 6) الأسماء والترقيم (مرآة FD-%04d وأرشفة safe_num.docx)
// ============================================================

describe("أسماء الملفات وأرقام المستندات", () => {
  test("FD-%04d من العدد+1", () => {
    expect(formDocNumber(1)).toBe("FD-0001");
    expect(formDocNumber(17)).toBe("FD-0017");
    expect(formDocNumber(1234)).toBe("FD-1234");
  });
  test("اسم المستند: تنظيف المحارف الممنوعة وقص 50 واسم الملف بالرقم", () => {
    expect(docFileName("نموذج/تجربة:ب?", "FD-0002")).toBe("نموذج_تجربة_ب__FD-0002.docx");
    const long = "ا".repeat(60);
    expect(docFileName(long, "FD-0003")).toBe(`${"ا".repeat(50)}_FD-0003.docx`);
    expect(docFileName("", "FD-0004")).toBe("نموذج_FD-0004.docx");
  });
  test("بادئة التخزين البروتوكولية موثقة", () => {
    expect(B64_PREFIX).toBe("base64:");
  });
});

// ============================================================
// 7) الحالات الشرعية وشاراتها ورسائل الحرس الحرفية
// ============================================================

describe("دورة حياة القالب — الحالات والأزرار والرسائل الحرفية", () => {
  test("الحالات الأربع حرفيًا وبترتيب المكتبي (form_service.py:39)", () => {
    expect(TEMPLATE_STATUSES).toEqual(["مسودة", "معتمد", "معطل", "مؤرشف"]);
  });
  test("الشارات: معتمد أزرق (INFO) والبقية رمادية كجدول STATUS_COLORS", () => {
    expect(templateStatusBadgeClass("معتمد")).toBe("bg-status-info-bg text-status-info");
    expect(templateStatusBadgeClass("مسودة")).toBe("bg-secondary text-secondary-foreground");
    expect(templateStatusBadgeClass("معطل")).toBe("bg-secondary text-secondary-foreground");
    expect(templateStatusBadgeClass("مؤرشف")).toBe("bg-secondary text-secondary-foreground");
    expect(templateStatusBadgeClass("حالة دخيلة")).toBe("bg-secondary text-secondary-foreground");
  });
  test("الأرشفة تبادلية معتمد⇄مؤرشف (مرآة _toggle_archive) — الشرعية بالعضوية", () => {
    // set_template_status بلا مصفوفة انتقالات: أي حالة من الأربع تصلح لأي أخرى
    const toggle = (st: string) => (st === "مؤرشف" ? "معتمد" : "مؤرشف");
    expect(toggle("مسودة")).toBe("مؤرشف");
    expect(toggle("مؤرشف")).toBe("معتمد");
    for (const st of ["مسودة", "معتمد", "معطل", "مؤرشف"]) {
      expect(TEMPLATE_STATUSES).toContain(st);
    }
    expect(MSG_TEMPLATE_BAD_STATUS).toBe("حالة النموذج غير صحيحة.");
  });
  test("رسائل الحرس الحرفية من import_docx/update/delete", () => {
    expect(MSG_TEMPLATE_NAME_REQUIRED).toBe("اسم النموذج مطلوب.");
    expect(MSG_TEMPLATE_DUP_IMPORT).toBe("يوجد نموذج بنفس الاسم.");
    expect(MSG_TEMPLATE_DUP_UPDATE).toBe("يوجد نموذج آخر بنفس الاسم.");
    expect(MSG_DELETE_USED).toBe("لا يمكن حذف النموذج لأنه استُخدم في مستندات محفوظة. يمكنك أرشفته بدل الحذف.");
    expect(MSG_CORRUPT_DOCX).toBe("تعذر قراءة ملف Word. تأكد أنه غير تالف وغير مفتوح.");
    expect(MSG_CHOOSE_DOCX).toBe("اختر ملف Word بصيغة .docx");
  });
  test("توست الرفع الحرفي (word_forms_center._import_word) وجاهزية الربط", () => {
    expect(MSG_UPLOAD_SUCCESS_PREFIX).toBe("تم رفع القالب. الحقول: ");
    // «n · مطابق تلقائيًا: m»
    expect(`${3} · مطابق تلقائيًا: ${2}`).toBe("3 · مطابق تلقائيًا: 2");
    expect(fieldsColumnText(5, 60)).toBe("5 · جاهزية 60%");
  });
});

// ============================================================
// 8) القوائم والجاهزية
// ============================================================

describe("ترتيب القوائم وجاهزية الربط (مرآة list_templates/analyze_template)", () => {
  test("ORDER BY: معتمد ثم مسودة ثم معطل ثم غيره · الاسم · الإصدار تنازلياً", () => {
    const rows = sortTemplates([
      { status: "مؤرشف", baseName: "أ", version: 1 },
      { status: "معطل", baseName: "ب", version: 1 },
      { status: "مسودة", baseName: "ج", version: 2 },
      { status: "مسودة", baseName: "ج", version: 1 },
      { status: "معتمد", baseName: "د", version: 1 },
      { status: "معتمد", baseName: "ز", version: 1 },
    ]);
    expect(rows.map((r) => `${r.status}:${r.baseName}:v${r.version}`)).toEqual([
      "معتمد:د:v1",
      "معتمد:ز:v1",
      "مسودة:ج:v2",
      "مسودة:ج:v1",
      "معطل:ب:v1",
      "مؤرشف:أ:v1",
    ]);
  });
  test("analyzeFields: النسب والأعداد (بلا حقول ⇒ 100%)", () => {
    expect(analyzeFields([]).readyPercent).toBe(100);
    const an = analyzeFields([
      { sourceType: "system" },
      { sourceType: "auto" },
      { sourceType: "calc" },
      { sourceType: "manual" },
      { sourceType: "manual" },
    ]);
    expect(an).toEqual({ total: 5, manual: 2, system: 1, auto: 1, calc: 1, readyPercent: 60 });
  });
  test("قواميس الأنواع الحرفية (FIELD_TYPES/SOURCE_TYPES)", () => {
    expect(SOURCE_TYPES).toEqual({
      manual: "إدخال يدوي", system: "من بيانات النظام",
      auto: "قيمة تلقائية", calc: "قيمة محسوبة",
    });
    expect(FIELD_TYPES["money"]).toBe("مبلغ مالي");
    expect(FIELD_TYPES["choice"]).toBe("قائمة اختيار");
  });
});
