/**
 * اختبار بند 8 — محرك استيراد Excel للأوراق الثماني.
 * المرجع المكتبي: services/import_service.py (المنطق والتحقق) + ui/import_wizard.py
 * (التدفق) + services/excel_service.py (نمط القوالب). المحلل نقي يُختبر على
 * حافظة صفوف صالحة/فاسدة (تكرار، عميل مفقود، تاريخ فاسد، مبلغ فاسد) وأخطاء برقم الصف،
 * والقالب يُبنى ثم يُقرأ بـexceljs للتأكد من الرؤوس العربية وصف المثال المتجاهل.
 */

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";

import {
  IMPORT_CONTRACT_STATUSES,
  IMPORT_INSTRUCTIONS,
  IMPORT_PAY_METHODS,
  IMPORT_SHEETS,
  sheetSpec,
} from "@/lib/import/sheets";
import { cellAmount, cellDate, cellStr, floatRepr, isValidDate, nameKey, typeKey } from "@/lib/import/normalize";
import {
  issueText,
  parseImportSheets,
  type ImportDbContext,
  type RawSheet,
} from "@/lib/import/parse-core";
import { buildImportTemplateBuffer } from "@/lib/import/template";

// ===== حافظة سياق اختبارية =====

const baseCtx = (): ImportDbContext => ({
  existingCustomerAliases: {},
  existingContracts: [],
  knownContractTypes: { [typeKey("تصميم معماري")]: "تصميم معماري" },
  expenseAccounts: {
    [nameKey("مصروفات تشغيلية / بنزين / وقود")]: 7,
    [nameKey("بنزين / وقود")]: 7,
  },
  existingReceiptNumbers: [],
  existingPaymentNumbers: [],
  projects: { [nameKey("مشروع zt")]: 3 },
  existingSubNames: [],
});

function sheet(name: string, dataRows: unknown[][]): RawSheet {
  const spec = sheetSpec(name)!;
  return { name, rows: [spec.columns.map(([h]) => h), ...dataRows] };
}

describe("الأوراق الثماني — التعريف الحرفي (import_service.py:22-104)", () => {
  test("الأسماء والترتيب الحرفي", () => {
    expect(IMPORT_SHEETS.map((s) => s.name)).toEqual([
      "العملاء",
      "العقود",
      "مقاولو الباطن",
      "الدفعات",
      "سندات القبض",
      "عقود الإشراف",
      "عقود الباطن",
      "سندات الصرف",
    ]);
  });

  test("أعمدة كل ورقة حرفية بعددها وترتيبها", () => {
    expect(IMPORT_SHEETS.map((s) => s.columns.map(([h]) => h))).toEqual([
      ["اسم العميل *", "رقم الهاتف *", "العنوان", "البريد الإلكتروني", "ملاحظات"],
      [
        "اسم العميل *",
        "اسم العقد / وصفه",
        "قيمة العقد *",
        "تاريخ العقد *",
        "تاريخ البداية",
        "تاريخ النهاية",
        "الحالة",
        "نوع العقد *",
      ],
      ["اسم المقاول *", "رقم الهاتف", "نوع النشاط", "ملاحظات"],
      ["اسم العميل *", "اسم العقد / وصفه", "المبلغ *", "التاريخ *", "البيان", "طريقة الدفع"],
      [
        "رقم السند القديم",
        "اسم العميل *",
        "اسم العقد / وصفه",
        "المبلغ *",
        "التاريخ *",
        "البيان",
        "طريقة الدفع",
        "ملاحظات",
      ],
      [
        "اسم العميل *",
        "اسم العقد / وصفه",
        "تاريخ تعهد الإشراف *",
        "المدة بالأشهر *",
        "قيمة الشهر *",
        "تاريخ العقد",
        "الحالة",
      ],
      [
        "اسم المقاول *",
        "اسم العميل *",
        "اسم العقد الرئيسي *",
        "قيمة عقد الباطن *",
        "تاريخ البداية",
        "تاريخ النهاية",
        "الوصف",
      ],
      [
        "رقم السند القديم",
        "حساب المصروف *",
        "اسم المستفيد (مقاول/مورد) *",
        "اسم العميل",
        "اسم المشروع",
        "اسم العقد الرئيسي",
        "المبلغ *",
        "التاريخ *",
        "البيان",
        "طريقة الدفع",
        "ملاحظات",
      ],
    ]);
  });

  test("الحالات وطرق الدفع وتعليمات القالب الحرفية", () => {
    expect(IMPORT_CONTRACT_STATUSES).toEqual(["نشط", "معتمد", "متوقف", "منتهي", "مغلق"]);
    expect(IMPORT_PAY_METHODS).toEqual(["نقدًا", "KNET", "شيك", "تحويل بنكي", "أخرى"]);
    expect(IMPORT_INSTRUCTIONS[0][0]).toBe("تعليمات تعبئة قالب البيانات القديمة");
    expect(IMPORT_INSTRUCTIONS.some(([t]) => t.includes("١٩. بعد التعبئة احفظ الملف"))).toBe(true);
  });
});

describe("المطبّعات — مرآة _name_key/_cell_*", () => {
  test("nameKey يتحمل الهمزات والتاء المربوطة والألف المقصورة والتشكيل والمسافات", () => {
    expect(nameKey("أحمد إبراهيم")).toBe(nameKey("احمد ابراهيم"));
    expect(nameKey("مؤسسة النور")).toBe(nameKey("مؤسسه النور"));
    expect(nameKey("على  السالم")).toBe(nameKey("علي السالم"));
    expect(nameKey("مُحَمَّد")).toBe(nameKey("محمد"));
    expect(nameKey(" شركة  الخليج ")).toBe("شركه الخليج");
  });

  test("cellStr: العدد الصحيح بلا كسر والنص مقصوص", () => {
    expect(cellStr(25000)).toBe("25000");
    expect(cellStr(25000.5)).toBe("25000.5");
    expect(cellStr(" نص ")).toBe("نص");
    expect(cellStr(null)).toBe("");
  });

  test("cellDate: الصيغ الخمس المكتبية والفاسد يُعاد كما هو ليرفضه الفحص", () => {
    expect(cellDate("2025-03-01")).toBe("2025-03-01");
    expect(cellDate("1/3/2025")).toBe("2025-03-01"); // d/m/Y أولًا
    expect(cellDate("1-3-2025")).toBe("2025-03-01");
    expect(cellDate("2025/03/01")).toBe("2025-03-01");
    expect(cellDate(new Date(Date.UTC(2025, 2, 1)))).toBe("2025-03-01");
    expect(cellDate("نص فاسد")).toBe("نص فاسد");
    expect(cellDate("2025-13-40")).toBe("2025-13-40"); // شهر/يوم غير معقولين — يفحصه isValidDate
    expect(isValidDate("2025-02-30")).toBe(false);
    expect(isValidDate("2025-02-28")).toBe(true);
    expect(isValidDate("2025-3-1")).toBe(false); // بلا أصفار — بصيغة YYYY-MM-DD النهائية فقط
  });

  test("cellAmount ينظف الرموز ويرجع null للفارغ/الفاسد", () => {
    expect(cellAmount("2,500.500")).toBe(2500.5);
    expect(cellAmount("25000 د.ك")).toBe(25000);
    expect(cellAmount(25000)).toBe(25000);
    expect(cellAmount("")).toBeNull();
    expect(cellAmount("abc")).toBeNull();
    expect(cellAmount("-5")).toBe(-5);
  });

  test("floatRepr يحاكي repr بايثون للمفاتيح الاحتياطية", () => {
    expect(floatRepr(25000)).toBe("25000.0");
    expect(floatRepr(200)).toBe("200.0");
    expect(floatRepr(2500.5)).toBe("2500.5");
  });
});

describe("محلل ورقة العملاء", () => {
  test("صف صالح يُقبل وبطاقة عميل واحد", () => {
    const res = parseImportSheets(
      [sheet("العملاء", [["شركة zt", "99887766", "الكويت", "a@b.com", "ملاحظة"]])],
      baseCtx()
    );
    expect(res.errors).toEqual([]);
    expect(res.counts.customers).toBe(1);
    expect(res.data.customers[0]).toMatchObject({ line: 2, name: "شركة zt", phone: "99887766" });
  });

  test("اسم فارغ وهاتف فارغ واسم مكرر — برقم الصف والرسائل الحرفية", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [
          ["", "11122233"],
          ["عميل zt", ""],
          ["عميل zt", "99999999"],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "العملاء سطر 2: اسم العميل فارغ.",
      "العملاء سطر 3: رقم الهاتف مطلوب.",
    ]);
    // الصف الثالث اسمه أول ظهور فعّال (الثاني رُفض قبل تسجيل المفتاح) — يُقبل كالعميل
    expect(res.counts.customers).toBe(1);
  });

  test("عميل موجود مسبقًا: الاسم الرسمي من السياق هو المرجع للربط", () => {
    const ctx = baseCtx();
    ctx.existingCustomerAliases = { [nameKey("عميل قديم")]: "عميل قديم الرسمي" };
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل قديم", "12345678"]]),
        sheet("العقود", [["عميل قديم", "عقد تجربة", "5000", "2025-03-01", "", "", "", "تصميم معماري"]]),
      ],
      ctx
    );
    expect(res.errors).toEqual([]);
    expect(res.data.contracts[0].customer_name).toBe("عميل قديم الرسمي");
  });
});

describe("محلل ورقة العقود — المرحلة 6 (منع «غير محدد»)", () => {
  const validRow = (over: Partial<unknown[]> = []): unknown[] => [
    "عميل zt",
    "عقد صيانة",
    "25000.000",
    "2025-03-01",
    "2025-03-01",
    "2026-02-28",
    "نشط",
    "تصميم معماري",
    ...over,
  ];

  test("صف صالح: النوع يُطبَّع للاسم الرسمي والحالة كما هي", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [["عميل zt", "عقد صيانة", 25000, "2025-03-01", "", "", "", "  تصميم معماري "]]),
      ],
      baseCtx()
    );
    expect(res.errors).toEqual([]);
    expect(res.data.contracts[0]).toMatchObject({
      amount: 25000,
      contract_type: "تصميم معماري",
      status: "نشط",
      contract_date: "2025-03-01",
    });
  });

  test("عميل مفقود ومبلغ فاسد وتاريخ فاسد — برقم الصف", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [
          ["عميل غائب", "عقد", "100", "2025-03-01", "", "", "", "تصميم معماري"],
          ["عميل zt", "عقد", "صفر", "2025-03-01", "", "", "", "تصميم معماري"],
          ["عميل zt", "عقد", "100", "31/02/2025", "", "", "", "تصميم معماري"],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "العقود سطر 2: العميل «عميل غائب» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.",
      "العقود سطر 3: قيمة العقد غير صالحة (صفر).",
      "العقود سطر 4: تاريخ العقد غير صالح (31/02/2025).",
    ]);
  });

  test("نوع فارغ يمنع الصف ونوع مجهول يولد رسالة الحلول الثلاثة بالأسطر", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [
          ["عميل zt", "عقد أ", "100", "2025-03-01", "", "", "", ""],
          ["عميل zt", "عقد ب", "100", "2025-03-01", "", "", "", "نوع غريب"],
        ]),
      ],
      baseCtx()
    );
    const texts = res.errors.map((e) => issueText(e));
    expect(texts[0]).toBe("العقود سطر 2: «نوع العقد» فارغ · حدّد النوع صراحةً · لن يُدخل العقد تحت «غير محدد».");
    expect(texts[1]).toContain("العقود: نوع العقد «نوع غريب» غير معتمد (أسطر: 3)");
    expect(texts[1]).toContain("تصميم معماري");
    expect(texts[1]).toContain("لن يُدخل العقد تحت «غير محدد».");
  });

  test("عمود نوع العقد المفقود كليًا — رسالة القالب الجديد", () => {
    const rows: RawSheet = {
      name: "العقود",
      rows: [
        ["اسم العميل *", "اسم العقد / وصفه", "قيمة العقد *", "تاريخ العقد *", "تاريخ البداية", "تاريخ النهاية", "الحالة"],
        ["عميل zt", "عقد", "100", "2025-03-01", "", "", ""],
      ],
    };
    const res = parseImportSheets([sheet("العملاء", [["عميل zt", "12345678"]]), rows], baseCtx());
    expect(res.errors.map((e) => issueText(e))[0]).toContain("عمود «نوع العقد» غير موجود في الملف");
  });

  test("حالة غير معروفة ⇒ تنبيه وتسجيل «نشط»، وعقد مكرر بنفس الاسم يرفض", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [
          ["عميل zt", "عقد أ", "100", "2025-03-01", "", "", "ملغي تمامًا", "تصميم معماري"],
          ["عميل zt", "عقد أ", "200", "2025-03-01", "", "", "نشط", "تصميم معماري"],
        ]),
      ],
      baseCtx()
    );
    expect(res.warnings.map((w) => issueText(w))).toContain(
      "العقود سطر 2: الحالة «ملغي تمامًا» غير معروفة · ستُسجل «نشط»."
    );
    expect(res.data.contracts[0].status).toBe("نشط");
    expect(res.errors.map((e) => issueText(e))).toContain(
      "العقود سطر 3: عقد مكرر لنفس العميل بنفس الاسم · ميّز الاسمين."
    );
  });
});

describe("محلل سندات القبض والدفعات", () => {
  function ctxWithContract(): ImportDbContext {
    const ctx = baseCtx();
    ctx.existingCustomerAliases = { [nameKey("عميل قائم")]: "عميل قائم" };
    ctx.existingContracts = [{ customerName: "عميل قائم", label: "عقد قائم", amount: 1000 }];
    return ctx;
  }

  test("قبض على عقد من الملف بلا اسم عقد ولعميل بعقد واحد — والبيان الافتراضي", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [["عميل zt", "", "1000", "2025-03-01", "", "", "نشط", "تصميم معماري"]]),
        sheet("الدفعات", [["عميل zt", "", "500", "2025-04-15", "دفعة أولى", "شيك"]]),
      ],
      baseCtx()
    );
    expect(res.errors).toEqual([]);
    expect(res.data.payments[0]).toMatchObject({
      customer_name: "عميل zt",
      contract_key: ["عميل zt", "عقد بقيمة 1000.0"],
      amount: 500,
      description: "دفعة أولى",
      method: "شيك",
      old_number: "",
    });
  });

  test("البيان الافتراضي «سند قبض (مستورد)» وطريقة غير معروفة ⇒ «أخرى» بتنبيه", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [["عميل zt", "عقد", "1000", "2025-03-01", "", "", "نشط", "تصميم معماري"]]),
        sheet("سندات القبض", [["RV-1", "عميل zt", "عقد", "500", "2025-04-15", "", "باي بال", ""]]),
      ],
      baseCtx()
    );
    expect(res.warnings.map((w) => issueText(w))).toContain(
      "سندات القبض سطر 2: طريقة الدفع «باي بال» ستُسجل «أخرى»."
    );
    expect(res.data.payments[0]).toMatchObject({ description: "سند قبض (مستورد)", method: "أخرى" });
  });

  test("عقد غير موجود ولعميل أكثر من عقد بلا تحديد — الرسائل الحرفية", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [
          ["عميل zt", "عقد أ", "1000", "2025-03-01", "", "", "نشط", "تصميم معماري"],
          ["عميل zt", "عقد ب", "1000", "2025-03-01", "", "", "نشط", "تصميم معماري"],
        ]),
        sheet("سندات القبض", [
          ["RV-1", "عميل zt", "عقد غريب", "500", "2025-04-15", "", "شيك", ""],
          ["RV-2", "عميل zt", "", "500", "2025-04-15", "", "شيك", ""],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "سندات القبض سطر 2: العقد «عقد غريب» غير موجود للعميل «عميل zt» في ورقة العقود.",
      "سندات القبض سطر 3: للعميل أكثر من عقد · حدد اسم العقد.",
    ]);
  });

  test("عميل غير موجود برقم السند القديم مكرر داخل الملف وموجود بالنظام", () => {
    const ctx = ctxWithContract();
    ctx.existingReceiptNumbers = ["RV-OLD-9"];
    const res = parseImportSheets(
      [
        sheet("سندات القبض", [
          ["RV-1", "عميل غائب", "عقد قائم", "500", "2025-04-15", "", "شيك", ""],
          ["RV-2", "عميل قائم", "عقد قائم", "500", "2025-04-15", "", "شيك", ""],
          ["RV-2", "عميل قائم", "عقد قائم", "600", "2025-04-16", "", "شيك", ""],
          ["RV-OLD-9", "عميل قائم", "عقد قائم", "700", "2025-04-17", "", "شيك", ""],
        ]),
      ],
      ctx
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "سندات القبض سطر 2: العميل «عميل غائب» غير موجود في ورقة العملاء أو قائمة العملاء الحالية.",
      "سندات القبض سطر 4: رقم السند القديم «RV-2» مكرر داخل الملف.",
    ]);
    expect(res.warnings.filter((w) => w.line > 0).map((w) => issueText(w))).toEqual([
      "سندات القبض سطر 5: رقم السند القديم «RV-OLD-9» موجود مسبقًا في النظام · تم تخطيه.",
    ]);
    expect(res.counts.payments).toBe(1);
  });

  test("تجاوز قيمة العقد: تنبيه دفعة مقدمة لا خطأ + التنبيه الختامي الحرفي", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("العقود", [["عميل zt", "عقد", "1000", "2025-03-01", "", "", "نشط", "تصميم معماري"]]),
        sheet("سندات القبض", [
          ["RV-1", "عميل zt", "عقد", "900", "2025-04-15", "", "شيك", ""],
          ["RV-2", "عميل zt", "عقد", "300", "2025-04-16", "", "شيك", ""],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => issueText(w).includes("مجموع سندات قبض عقد «عقد» (1,200.000) يتجاوز قيمته (1,000.000)"))).toBe(
      true
    );
    expect(
      res.warnings.some(
        (w) =>
          w.sheet === "سندات القبض" &&
          w.line === 0 &&
          issueText(w).includes("سندات القبض على عقد «عقد» للعميل «عميل zt»") &&
          issueText(w).includes("(زيادة 200.000)")
      )
    ).toBe(true);
  });
});

describe("محلل مقاولي الباطن وعقود الإشراف وعقود الباطن", () => {
  test("مقاول صالح ومكرر — واسم فارغ", () => {
    const res = parseImportSheets(
      [
        sheet("مقاولو الباطن", [
          ["مؤسسة zt", "66554433", "أعمال كهرباء", ""],
          ["", "", "", ""],
          ["مؤسسة zt", "11111111", "", ""],
        ]),
      ],
      baseCtx()
    );
    expect(res.counts.subs).toBe(1);
    expect(res.errors.map((e) => issueText(e))).toEqual(["مقاولو الباطن سطر 4: «مؤسسة zt» مكرر."]);
  });

  test("إشراف: القيمة = المدة × قيمة الشهر والمدة/الشهر/التاريخ الفاسدة برقم الصف", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("عقود الإشراف", [
          ["عميل zt", "إشراف فيلا", "2025-05-01", "4", "200.000", "2025-04-20", "نشط"],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors).toEqual([]);
    expect(res.data.sup_contracts[0]).toMatchObject({
      months: 4,
      monthly: 200,
      amount: 800,
      contract_date: "2025-04-20",
    });
    const second = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("عقود الإشراف", [
          ["عميل zt", "إشراف ٢", "2025-05-01", "0", "200", "", ""],
          ["عميل zt", "إشراف ٣", "2025-05-01", "3", "0", "", ""],
          ["عميل zt", "إشراف ٤", "فاسد", "3", "100", "", ""],
        ]),
      ],
      baseCtx()
    );
    expect(second.errors.map((e) => issueText(e))).toEqual([
      "عقود الإشراف سطر 2: المدة بالأشهر غير صالحة (0).",
      "عقود الإشراف سطر 3: قيمة الشهر غير صالحة (0).",
      "عقود الإشراف سطر 4: تاريخ تعهد الإشراف غير صالح (فاسد).",
    ]);
  });

  test("عقد باطن: مقاول غير موجود والعقد الرئيسي غير موجود وقيمة فاسدة — والصالح يمر", () => {
    const res = parseImportSheets(
      [
        sheet("العملاء", [["عميل zt", "12345678"]]),
        sheet("مقاولو الباطن", [["مؤسسة zt", "66", "كهرباء", ""]]),
        sheet("العقود", [["عميل zt", "عقد رئيسي", "10000", "2025-03-01", "", "", "نشط", "تصميم معماري"]]),
        sheet("عقود الباطن", [
          ["مقاول غائب", "عميل zt", "عقد رئيسي", "3000", "2025-03-15", "2025-09-15", "كهرباء"],
          ["مؤسسة zt", "عميل zt", "عقد غير موجود", "3000", "", "", ""],
          ["مؤسسة zt", "عميل zt", "عقد رئيسي", "صفر", "", "", ""],
          ["مؤسسة zt", "عميل zt", "عقد رئيسي", "3000", "2025-03-15", "2025-09-15", "أعمال الكهرباء"],
        ]),
      ],
      baseCtx()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "عقود الباطن سطر 2: المقاول «مقاول غائب» غير موجود في ورقة مقاولي الباطن.",
      "عقود الباطن سطر 3: العقد «عقد غير موجود» غير موجود للعميل «عميل zt».",
      "عقود الباطن سطر 4: قيمة عقد الباطن غير صالحة (صفر).",
    ]);
    expect(res.data.sub_contracts[0]).toMatchObject({
      sub_name: "مؤسسة zt",
      amount: 3000,
      description: "أعمال الكهرباء",
    });
  });
});

describe("محلل سندات الصرف", () => {
  function ctxFull(): ImportDbContext {
    const ctx = baseCtx();
    ctx.existingCustomerAliases = { [nameKey("عميل قائم")]: "عميل قائم" };
    ctx.existingContracts = [{ customerName: "عميل قائم", label: "عقد قائم", amount: 5000 }];
    ctx.existingSubNames = ["مؤسسة باطن"];
    return ctx;
  }

  test("مصروف عام بدون عميل: حساب المسار الكامل يطابق والافتراضي «مصروف عام (مستورد)»", () => {
    const res = parseImportSheets(
      [
        sheet("سندات الصرف", [
          ["PV-1", "بنزين / وقود", "محطة الوقود", "", "", "", "15", "2025-05-10", "بنزين", "تحويل بنكي", "قديم"],
        ]),
      ],
      ctxFull()
    );
    expect(res.errors).toEqual([]);
    expect(res.data.expenses[0]).toMatchObject({
      expense_account_id: 7,
      party_name: "محطة الوقود",
      is_sub: false,
      contract_key: null,
      description: "بنزين",
      amount: 15,
    });
  });

  test("حساب مفقود ومستفيد فارغ ومشروع غير موجود وعقد بلا عميل — الرسائل الحرفية", () => {
    const res = parseImportSheets(
      [
        sheet("سندات الصرف", [
          ["PV-1", "حساب غريب", "مورد", "", "", "", "15", "2025-05-10", "", "", ""],
          ["PV-2", "بنزين / وقود", "", "", "", "", "15", "2025-05-10", "", "", ""],
          ["PV-3", "بنزين / وقود", "مورد", "", "مشروع غائب", "", "15", "2025-05-10", "", "", ""],
          ["PV-4", "بنزين / وقود", "مورد", "", "", "عقد قائم", "15", "2025-05-10", "", "", ""],
        ]),
      ],
      ctxFull()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "سندات الصرف سطر 2: حساب المصروف «حساب غريب» غير موجود في إعدادات حسابات المصروفات.",
      "سندات الصرف سطر 3: اسم المستفيد فارغ.",
      "سندات الصرف سطر 4: المشروع «مشروع غائب» غير موجود.",
      "سندات الصرف سطر 5: عند كتابة اسم العقد يجب كتابة اسم العميل أيضًا.",
    ]);
  });

  test("صرف لمقاول على عقد: تجاوز قيمة عقد الباطن خطأ يوقف الصف", () => {
    const res = parseImportSheets(
      [
        sheet("مقاولو الباطن", [["مؤسسة باطن", "66", "", ""]]),
        sheet("العملاء", [["عميل قائم", "12345678"]]),
        sheet("عقود الباطن", [["مؤسسة باطن", "عميل قائم", "عقد قائم", "100", "", "", ""]]),
        sheet("سندات الصرف", [
          ["PV-1", "بنزين / وقود", "مؤسسة باطن", "عميل قائم", "", "عقد قائم", "60", "2025-05-10", "", "", ""],
          ["PV-2", "بنزين / وقود", "مؤسسة باطن", "عميل قائم", "", "عقد قائم", "60", "2025-05-11", "", "", ""],
        ]),
      ],
      ctxFull()
    );
    expect(res.errors.map((e) => issueText(e))).toEqual([
      "سندات الصرف سطر 3: مجموع الصرف للمقاول «مؤسسة باطن» (120.000) يتجاوز قيمة عقد باطنه (100.000).",
    ]);
    expect(res.counts.expenses).toBe(1);
  });

  test("رقم قديم موجود بالنظام ⇒ تنبيه وتخطي (skipExisting يُحسب في العدّاد)", () => {
    const ctx = ctxFull();
    ctx.existingPaymentNumbers = ["PV-OLD-1"];
    const res = parseImportSheets(
      [
        sheet("سندات الصرف", [
          ["PV-OLD-1", "بنزين / وقود", "مورد", "", "", "", "15", "2025-05-10", "", "", ""],
        ]),
      ],
      ctx
    );
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.line > 0).map((w) => issueText(w))).toEqual([
      "سندات الصرف سطر 2: رقم السند القديم «PV-OLD-1» موجود مسبقًا في النظام · سيتم تخطيه.",
    ]);
    expect(res.counts.expenses).toBe(1);
    expect(res.data.expenses[0].skipExisting).toBe(true);
  });

  test("مشروع موجود يُحل بمعرفه والعميل بملفه أو بقاعدته", () => {
    const res = parseImportSheets(
      [
        sheet("سندات الصرف", [
          ["PV-1", "بنزين / وقود", "مورد", "عميل قائم", "مشروع zt", "عقد قائم", "15", "2025-05-10", "بنزين", "", ""],
        ]),
      ],
      ctxFull()
    );
    expect(res.errors).toEqual([]);
    expect(res.data.expenses[0]).toMatchObject({ project_id: 3, expense_customer_name: "عميل قائم" });
  });
});

describe("قراءة القالب وإعادة فحصه — صف المثال يُتجاهل", () => {
  test("القالب الكامل: الأوراق بترتيبها و«اقرأني أولاً» تُقرأ عربية RTL والفحص صفر أخطاء", async () => {
    const { buffer, filename } = await buildImportTemplateBuffer({ knownTypes: ["تصميم معماري", "بناء"] });
    expect(filename).toBe("قالب_البيانات_القديمة.xlsx");
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["اقرأني أولاً", ...IMPORT_SHEETS.map((s) => s.name)]);
    const readMe = wb.worksheets[0];
    expect(readMe.getCell("A1").value).toBe("تعليمات تعبئة قالب البيانات القديمة");
    const view = readMe.views[0] as ExcelJS.WorksheetViewBasic;
    expect(view.rightToLeft).toBe(true);

    const cust = wb.getWorksheet("العملاء")!;
    expect(cust.getCell("A1").value).toBe("اسم العميل *");
    expect(cust.getCell("B1").value).toBe("رقم الهاتف *");
    // صف المثال بعلامته
    expect(cust.getCell("A2").value).toBe("شركة الخليج التجارية");
    expect(String(cust.getCell("F2").value ?? "")).toContain("مثال");

    // أعمدة العقود + الملاحظة بعد العمود الثامن
    const con = wb.getWorksheet("العقود")!;
    expect(con.getCell("H1").value).toBe("نوع العقد *");
    expect(String(con.getCell("I1").value ?? "")).toContain("نوع العقد إجباري");
    // قائمة منسدلة للحالة
    expect(con.getCell("G3").dataValidation?.type).toBe("list");

    // إعادة فحص القالب نفسه: لا صفوف ولا أخطاء (المثال والفارغ يُتجاهلان)
    const rawSheets: RawSheet[] = wb.worksheets.map((ws) => {
      const rows: unknown[][] = [];
      for (let r = 1; r <= ws.rowCount; r++) {
        const row: unknown[] = [];
        for (let c = 1; c <= ws.columnCount; c++) row.push(ws.getCell(r, c).value);
        rows.push(row);
      }
      return { name: ws.name, rows };
    });
    const res = parseImportSheets(rawSheets, baseCtx());
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.counts.customers).toBe(0);
    expect(res.counts.contracts).toBe(0);
  });

  test("قالب ورقة واحدة برؤوسها فقط واسم الملف المركب", async () => {
    const { buffer, filename } = await buildImportTemplateBuffer({ sheet: "سندات الصرف" });
    expect(filename).toBe("قالب_سندات الصرف.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["سندات الصرف"]);
    expect(wb.getWorksheet("سندات الصرف")!.getCell("B1").value).toBe("حساب المصروف *");
  });

  test("مسح المستخدم أول خانة من صف المثال لا يُدخله (بقية بيانات المثال تُكشف)", () => {
    const spec = sheetSpec("العملاء")!;
    const exampleRow = [...spec.example];
    exampleRow[0] = ""; // مسح الاسم
    const res = parseImportSheets([sheet("العملاء", [exampleRow, ["عميل حقيقي", "12345678"]])], baseCtx());
    expect(res.counts.customers).toBe(1);
    expect(res.data.customers[0].name).toBe("عميل حقيقي");
    expect(res.data.customers[0].line).toBe(3);
  });
});

describe("الأوراق الغائبة والتنبيهات", () => {
  test("ورقة غائبة ⇒ تنبيه تخطٍ لا خطأ — للأوراق السبع الباقية بترتيب الفحص", () => {
    const res = parseImportSheets([sheet("العملاء", [["عميل zt", "12345678"]])], baseCtx());
    expect(res.errors).toEqual([]);
    expect(res.warnings.map((w) => issueText(w))).toEqual([
      "ورقة «العقود» غير موجودة، سيتم تخطيها.",
      "ورقة «مقاولو الباطن» غير موجودة، سيتم تخطيها.",
      "ورقة «عقود الإشراف» غير موجودة، سيتم تخطيها.",
      "ورقة «الدفعات» غير موجودة، سيتم تخطيها.",
      "ورقة «سندات القبض» غير موجودة، سيتم تخطيها.",
      "ورقة «عقود الباطن» غير موجودة، سيتم تخطيها.",
      "ورقة «سندات الصرف» غير موجودة، سيتم تخطيها.",
    ]);
    expect(res.sheetsPresent).toEqual(["العملاء"]);
  });

  test("الأوراق غير المعترفة (مثل ورقة عشوائية) لا تدخل الأوراق الحاضرة", () => {
    const res = parseImportSheets(
      [{ name: "ورقة عشوائية", rows: [["x"], ["y"]] }, sheet("العملاء", [])],
      baseCtx()
    );
    expect(res.sheetsPresent).toEqual(["العملاء"]);
    expect(Object.keys(res.preview)).toEqual(["العملاء"]);
  });
});
