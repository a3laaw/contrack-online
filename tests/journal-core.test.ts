/**
 * اختبارات نواة القيد المزدوج — Task 104.
 * الغلاف: التحقق الصارم من القيد، العكس، الفترات، حاسم الأسماء القديمة،
 * وترحيل القيود النصية القديمة — كلها دوال نقية بلا قاعدة بيانات.
 */
import { describe, expect, test } from "bun:test";
import {
  buildReversalLines,
  isDateInOpenPeriod,
  LEGACY_ACCOUNT_MAP,
  migrateLegacyJournalRows,
  normalizeMatchAr,
  periodKeyOf,
  resolveLegacyAccountName,
  r3,
  SUSPENSE_ACCOUNT,
  validateJournalEntry,
  type AccountResolveCandidate,
  type JournalEntryInput,
} from "../src/lib/accounting-journal";

/** دليل مصغّر للاختبار — نفس أكواد البذرة القياسية */
const CHART: AccountResolveCandidate[] = [
  { id: 1, code: "1111", name: "الصندوق", allowPosting: true, isActive: true },
  { id: 2, code: "1112", name: "البنك — الحساب الجاري", allowPosting: true, isActive: true },
  { id: 3, code: "1121", name: "العملاء", allowPosting: true, isActive: true },
  { id: 4, code: "1140", name: "عُهد وسلف الموظفين", allowPosting: true, isActive: true },
  { id: 5, code: "4100", name: "إيرادات العقود", allowPosting: true, isActive: true },
  { id: 6, code: "5210", name: "رواتب وأجور", allowPosting: true, isActive: true },
  { id: 7, code: "5260", name: "رسوم وعمولات بنكية", allowPosting: true, isActive: true },
  { id: 11, code: "5240", name: "صيانة ووقود", allowPosting: true, isActive: true },
  { id: 8, code: "5300", name: "مصروفات أخرى", allowPosting: true, isActive: true },
  // عقدة إجمالية غير مسموح نشرها + حساب معطل
  { id: 9, code: "1100", name: "الأصول المتداولة", allowPosting: false, isActive: true },
  { id: 10, code: "2999", name: "حساب تسوية مؤقت", allowPosting: true, isActive: true },
];

const accountsMap = () =>
  new Map(
    CHART.map((a) => [a.id, { allowPosting: a.allowPosting, isActive: a.isActive }])
  );

const balancedEntry = (): JournalEntryInput => ({
  entryDate: "2025-06-15",
  description: "قيد اختبار",
  lines: [
    { accountId: 6, debit: 500, credit: 0, description: "رواتب" },
    { accountId: 1, debit: 0, credit: 500, description: "صندوق" },
  ],
});

describe("r3 — التقريب الثلاثي", () => {
  test("يمنع انحراف الفاصلة العائمة", () => {
    expect(r3(0.1 + 0.2)).toBe(0.3);
    expect(r3(1.0005)).toBe(1.001);
    expect(r3(NaN)).toBe(0);
  });
});

describe("validateJournalEntry — صرامة المحرك", () => {
  test("قيد متوازن سليم يُقبل مع مجاميع صحيحة", () => {
    const check = validateJournalEntry(balancedEntry(), accountsMap());
    expect(check.ok).toBe(true);
    expect(check.totalDebit).toBe(500);
    expect(check.totalCredit).toBe(500);
    expect(check.diff).toBe(0);
  });

  test("قيد غير متوازن يُرفض برسالة عربية", () => {
    const e = balancedEntry();
    e.lines[0].debit = 400;
    const check = validateJournalEntry(e, accountsMap());
    expect(check.ok).toBe(false);
    expect(check.error).toContain("غير متوازن");
  });

  test("سطر بمبلغ صفري يُرفض", () => {
    const e = balancedEntry();
    e.lines[1].credit = 0;
    expect(validateJournalEntry(e, accountsMap()).error).toContain("سطر 2");
  });

  test("طرف مدين ودائن معًا يُرفض", () => {
    const e = balancedEntry();
    e.lines[0].credit = 500;
    expect(validateJournalEntry(e, accountsMap()).error).toContain("معًا");
  });

  test("مبلغ سالب يُرفض", () => {
    const e = balancedEntry();
    e.lines[0].debit = -500;
    e.lines[1].credit = -500;
    expect(validateJournalEntry(e, accountsMap()).error).toContain("سالبة");
  });

  test("حساب إجمالي غير مسموح نشره يُرفض", () => {
    const e = balancedEntry();
    e.lines[0].accountId = 9;
    expect(validateJournalEntry(e, accountsMap()).error).toContain("إجمالي");
  });

  test("حساب غير موجود يُرفض", () => {
    const e = balancedEntry();
    e.lines[1].accountId = 999;
    expect(validateJournalEntry(e, accountsMap()).error).toContain("غير موجود");
  });

  test("سطر واحد يُرفض (لا معنى لقيد بطرف واحد)", () => {
    const e: JournalEntryInput = {
      entryDate: "2025-06-15",
      description: "سطر واحد",
      lines: [{ accountId: 1, debit: 100, credit: 0 }],
    };
    expect(validateJournalEntry(e, accountsMap()).error).toContain("سطرين");
  });

  test("تاريخ مشوه وبيان فارغ يُرفضان", () => {
    const e = balancedEntry();
    e.entryDate = "15/06/2025";
    expect(validateJournalEntry(e, accountsMap()).error).toContain("YYYY-MM-DD");
    const e2 = balancedEntry();
    e2.description = "  ";
    expect(validateJournalEntry(e2, accountsMap()).error).toContain("بيان");
  });

  test("توازن عشري ثلاثي يُقبل ضمن الفلس", () => {
    const e: JournalEntryInput = {
      entryDate: "2025-06-15",
      description: "عشري",
      lines: [
        { accountId: 8, debit: 100.005, credit: 0 },
        { accountId: 1, debit: 0, credit: 100.005 },
      ],
    };
    expect(validateJournalEntry(e, accountsMap()).ok).toBe(true);
  });
});

describe("buildReversalLines — القيد العكسي", () => {
  test("يبدل المدين والدائن سطرًا بسطر مع حفظ الأبعاد", () => {
    const lines = [
      { accountId: 6, debit: 120, credit: 0, description: "رواتب", contractId: 7, costCenter: "أ" },
      { accountId: 1, debit: 0, credit: 120, description: "صندوق" },
    ];
    const rev = buildReversalLines(lines);
    expect(rev[0].debit).toBe(0);
    expect(rev[0].credit).toBe(120);
    expect(rev[1].debit).toBe(120);
    expect(rev[1].credit).toBe(0);
    expect(rev[0].contractId).toBe(7);
    expect(rev[0].costCenter).toBe("أ");
  });
});

describe("الفترات المالية", () => {
  test("periodKeyOf يستخرج الشهر من تاريخ النظام", () => {
    expect(periodKeyOf("2025-03-14")).toBe("2025-03");
  });

  test("الفترة المقفلة ترفض والمفقودة تعامل مفتوحة", () => {
    const statuses = new Map([["2025-01", "closed"], ["2025-02", "open"]]);
    expect(isDateInOpenPeriod(statuses, "2025-01-31")).toBe(false);
    expect(isDateInOpenPeriod(statuses, "2025-02-10")).toBe(true);
    expect(isDateInOpenPeriod(statuses, "2025-05-01")).toBe(true); // تُبذر آليًا
  });

  test("مفتاح غير صالح يرفض", () => {
    expect(isDateInOpenPeriod(new Map(), "2025")).toBe(false);
    expect(isDateInOpenPeriod(new Map(), "2025-13-01")).toBe(false);
  });
});

describe("normalizeMatchAr — تطبيع المطابقة", () => {
  test("يُوحد الهمزات والتاء المربوطة والألف المقصورة", () => {
    expect(normalizeMatchAr("مصروفات أخرى")).toBe("مصروفات اخري");
    expect(normalizeMatchAr("العُهدة")).toBe("العهده");
    expect(normalizeMatchAr("إيجار ى")).toBe("ايجار ي");
  });
});

describe("resolveLegacyAccountName — حسم الأسماء القديمة", () => {
  test("مطابقة تامة لاسم الدليل", () => {
    expect(resolveLegacyAccountName("العملاء", CHART)).toBe(3);
    expect(resolveLegacyAccountName("رواتب وأجور", CHART)).toBe(6);
  });

  test("الخريطة الثابتة: أسماء عصور النصوص → أكواد البذرة", () => {
    expect(resolveLegacyAccountName("بنك", CHART)).toBe(2);
    expect(resolveLegacyAccountName("صندوق", CHART)).toBe(1);
    expect(resolveLegacyAccountName("العهد", CHART)).toBe(4);
    expect(resolveLegacyAccountName("رواتب", CHART)).toBe(6);
    expect(resolveLegacyAccountName("مصروفات أخرى", CHART)).toBe(8);
    expect(LEGACY_ACCOUNT_MAP[normalizeMatchAr("إيرادات العقود")]).toBe("4100");
  });

  test("أسماء مسارية قديمة تُحسم بمقاطعها الأعمق", () => {
    // "بنزين / وقود" → مقطع "وقود" يضمّ فريدًا في "صيانة ووقود"
    expect(resolveLegacyAccountName("مصروفات تشغيلية / بنزين / وقود", CHART)).toBe(11);
    // جسر الاسم الدقيق "عمولات" عبر الخريطة "عمولات بنكيه"
    expect(resolveLegacyAccountName("عمولات بنكية", CHART)).toBe(7);
  });

  test("غير المحسوم يعيد null (يوجه لحساب التسوية)", () => {
    expect(resolveLegacyAccountName("شيء غير معروف نهائيًا", CHART)).toBe(null);
    expect(resolveLegacyAccountName("", CHART)).toBe(null);
  });
});

describe("migrateLegacyJournalRows — ترحيل القيود النصية", () => {
  const resolve = (name: string) => {
    const map: Record<string, number> = {
      "رواتب": 6,
      "صندوق": 1,
      "العملاء": 3,
    };
    return map[name] ?? null;
  };
  const rows = [
    {
      id: 11,
      companyId: 1,
      entryDate: "2024-05-01",
      description: "سند قبض RV-0001",
      debitAccount: "صندوق",
      creditAccount: "العملاء",
      amount: 250.5,
      contractId: 42,
      sourceType: "voucher",
      sourceId: 91,
    },
    {
      id: 12,
      companyId: 1,
      entryDate: "2024-05-02",
      description: "سند صرف PV-0002",
      debitAccount: "شيء غامض",
      creditAccount: "صندوق",
      amount: 100,
      sourceType: "voucher",
      sourceId: 92,
    },
    {
      id: 13,
      companyId: 1,
      entryDate: "2024-05-03",
      description: "صريح صفر",
      debitAccount: "صندوق",
      creditAccount: "صندوق",
      amount: 0,
    },
  ];

  test("كل صف يصير قيدًا منشورًا من طرفين بترقيم تعاقبي وأبعاد محفوظة", () => {
    const out = migrateLegacyJournalRows(rows, resolve, 10);
    expect(out.entries.length).toBe(2); // الصف الصفري يُسقط
    const first = out.entries[0];
    expect(first.entryNo).toBe(1);
    expect(first.status).toBe("posted");
    expect(first.sourceType).toBe("voucher");
    expect(first.sourceId).toBe(91);
    expect(first.lines.length).toBe(2);
    expect(first.lines[0]).toMatchObject({ accountId: 1, debit: 250.5, credit: 0, contractId: 42 });
    expect(first.lines[1]).toMatchObject({ accountId: 3, debit: 0, credit: 250.5 });
    // توازن كل قيد مرحَّل
    for (const e of out.entries) {
      const d = e.lines.reduce((s, l) => s + l.debit, 0);
      const c = e.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(d - c)).toBeLessThan(0.001);
    }
    // ترقيم متعاقب
    expect(out.entries[1].entryNo).toBe(2);
  });

  test("غير المحسوم يوجه لحساب التسوية ويُبلَّغ عنه", () => {
    const out = migrateLegacyJournalRows(rows, resolve, 10);
    expect(out.suspenseUsed).toBe(1);
    expect(out.unmatched).toEqual([{ rowId: 12, side: "debit", name: "شيء غامض" }]);
    const second = out.entries[1];
    expect(second.lines[0].accountId).toBe(SUSPENSE_ACCOUNT.code === "2999" ? 10 : 10);
    expect(second.lines[0].description).toBe("شيء غامض"); // الاسم محفوظ للمراجعة
  });

  test("startEntryNo يواصل الترقيم عند الترحيل على دفعات", () => {
    const out = migrateLegacyJournalRows([rows[0]], resolve, 10, 100);
    expect(out.entries[0].entryNo).toBe(100);
  });
});
