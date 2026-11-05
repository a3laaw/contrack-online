/**
 * اختبارات نواة مخرجات المحاسبة — Task 108.
 * الغلاف: بناء صفوف دفتر الأستاذ بالرصيد الجاري، شيخوخة FIFO بالاتجاهين
 * (عملاء مدين / باطن دائن)، ميزان المراجعة (العمودان والتوازن والملخصات)،
 * وتحويلات جدول التصدير الموحد — كلها دوال نقية بلا قاعدة بيانات.
 */
import { describe, expect, test } from "bun:test";
import {
  agingBucketIndex,
  agingReportTable,
  buildGlRows,
  daysPast,
  fifoAging,
  glReportTable,
  tbByType,
  tbDebitCredit,
  tbReportTable,
  tbTotals,
  type GlMovement,
  type TbAccountRow,
} from "../src/lib/accounting-reports-core";
import { r3 } from "../src/lib/accounting-journal";

// ==================== بناء صفوف دفتر الأستاذ ====================

describe("buildGlRows — الرصيد الجاري", () => {
  const mv = (debit: number, credit: number, entryNo = 1): GlMovement => ({
    entryNo,
    entryDate: "2025-06-15",
    description: "قيد",
    lineDescription: "",
    debit,
    credit,
    sourceType: "voucher",
  });

  test("رصيد جارٍ مدين ثم دائن مع الطرف الظاهر", () => {
    const rows = buildGlRows(100, [mv(250), mv(200, 0, 2), mv(0, 300, 3)]);
    expect(rows.length).toBe(3);
    // افتتاحي 100 + 250 = 350 مدين
    expect(rows[0].balance).toBe(350);
    expect(rows[0].balanceSide).toBe("debit");
    // 350 + 200 = 550 مدين
    expect(rows[1].balance).toBe(550);
    // 550 − 300 = 250 مدين
    expect(rows[2].balance).toBe(250);
    expect(rows[2].balanceSide).toBe("debit");
  });

  test("التحول للطرف الدائن عند تجاوز الصفر", () => {
    const rows = buildGlRows(0, [mv(0, 500, 1), mv(200, 0, 2)]);
    expect(rows[0].balance).toBe(500);
    expect(rows[0].balanceSide).toBe("credit");
    expect(rows[1].balance).toBe(300);
    expect(rows[1].balanceSide).toBe("credit");
  });

  test("الافتتاحي الدائن السالب يبدأ بطرف دائن", () => {
    const rows = buildGlRows(-1000, [mv(300, 0)]);
    expect(rows[0].balance).toBe(700);
    expect(rows[0].balanceSide).toBe("credit");
  });

  test("الافتتاحي الصفري بدون حركات = جدول فارغ", () => {
    expect(buildGlRows(0, [])).toEqual([]);
  });

  test("تقريب الفلس عبر r3 يمنع انحراف الفاصلة", () => {
    const rows = buildGlRows(0.1, [mv(0.2), mv(0.3, 0, 2)]);
    expect(rows[1].balance).toBe(0.6);
  });
});

// ==================== أعمار الذمم ====================

describe("fifoAging — العملاء (طبيعة مدين)", () => {
  test("بند مدين واحد غير مسوّى يُشيَّخ من تاريخه", () => {
    const res = fifoAging([{ date: "2025-01-01", debit: 1000, credit: 0 }], "2025-03-15", "debit");
    expect(res.balance).toBe(1000);
    expect(res.direction).toBe("debit");
    // 73 يومًا → فوق 90؟ لا: 73 → bucket 61-90
    expect(res.oldestDays).toBe(73);
    expect(res.buckets[2]).toBe(1000);
  });

  test("التسوية تستهلك الأقدم أولًا FIFO", () => {
    const res = fifoAging(
      [
        { date: "2025-04-01", debit: 600, credit: 0 },
        { date: "2025-04-20", debit: 400, credit: 0 },
        { date: "2025-04-25", debit: 0, credit: 700 },
      ],
      "2025-04-30",
      "debit"
    );
    // سداد 700: يستهلك 600 كاملًا ثم 100 من بند 400 — المتبقي 300 بتاريخ 2025-04-20 (10 أيام)
    expect(res.balance).toBe(300);
    expect(res.buckets[0]).toBe(300);
    expect(res.buckets[1]).toBe(0);
    expect(res.oldestDays).toBe(10);
  });

  test("السداد الزائد = رصيد معاكس دائن في الحالية", () => {
    const res = fifoAging(
      [
        { date: "2025-03-01", debit: 500, credit: 0 },
        { date: "2025-03-05", debit: 0, credit: 800 },
      ],
      "2025-03-10",
      "debit"
    );
    expect(res.balance).toBe(300);
    expect(res.direction).toBe("credit");
    expect(res.buckets[0]).toBe(-300);
    expect(res.oldestDays).toBeNull();
  });

  test("السداد قبل أي بند = دفعة مقدمة معاكسة", () => {
    const res = fifoAging([{ date: "2025-03-01", debit: 0, credit: 250 }], "2025-03-10", "debit");
    expect(res.direction).toBe("credit");
    expect(res.buckets[0]).toBe(-250);
  });

  test("فائض السداد يُحمل للأمام ويُسوّى بالبنود اللاحقة (اتساق مع رصيد الأستاذ)", () => {
    // فاتورة 2000 سُدد منها 2500؟ لا — السيناريو المثبت من بيانات T107:
    // سداد 1730 فائضًا عن بنود مسودة ثم فاتورة معدّلة 1800 + فاتورة 50 → المتبقي 120
    const res = fifoAging(
      [
        { date: "2025-05-01", debit: 0, credit: 1730 }, // فائض بلا بنود مفتوحة
        { date: "2025-05-10", debit: 1800, credit: 0 }, // يُسوّى منه 1730
        { date: "2025-05-20", debit: 50, credit: 0 },
      ],
      "2025-06-30",
      "debit"
    );
    expect(res.balance).toBe(120); // 1800−1730 + 50 — يوافق رصيد الحساب بالأستاذ
    expect(res.buckets[1]).toBe(120); // 51 و41 يومًا → كلاهما في فئة 31–60
    expect(res.oldestDays).toBe(51);
  });

  test("الأرصدة المسوّاة كليًا تُستبعد", () => {
    const res = fifoAging(
      [
        { date: "2025-01-10", debit: 400, credit: 0 },
        { date: "2025-01-15", debit: 0, credit: 400 },
      ],
      "2025-06-01",
      "debit"
    );
    expect(res.balance).toBe(0);
    expect(res.direction).toBeNull();
    expect(res.buckets).toEqual([0, 0, 0, 0]);
  });
});

describe("fifoAging — الباطن (طبيعة دائن)", () => {
  test("استحقاق باطن مفتوح يُشيَّخ من تاريخه", () => {
    const res = fifoAging(
      [{ date: "2025-01-20", debit: 0, credit: 2000 }],
      "2025-04-30",
      "credit"
    );
    expect(res.balance).toBe(2000);
    expect(res.direction).toBe("credit"); // مستحق دائن للباطن
    // 100 يوم → فوق 90
    expect(res.buckets[3]).toBe(2000);
    expect(res.oldestDays).toBe(100);
  });

  test("دفعة للمقاول تستهلك الأقدم أولًا", () => {
    const res = fifoAging(
      [
        { date: "2025-02-01", debit: 0, credit: 1500 },
        { date: "2025-02-10", debit: 0, credit: 500 },
        { date: "2025-02-15", debit: 1200, credit: 0 },
      ],
      "2025-03-01",
      "credit"
    );
    // دفعة 1200: تستهلك 1200 من بند 1500 — المتبقي 300 (28 يومًا) + بند 500 كامل (19 يومًا)
    expect(res.balance).toBe(800);
    expect(res.direction).toBe("credit");
    expect(res.buckets[0]).toBe(300 + 500);
  });
});

describe("مؤيدات الأعمار", () => {
  test("agingBucketIndex الحدود الثلاثية", () => {
    expect(agingBucketIndex(0)).toBe(0);
    expect(agingBucketIndex(30)).toBe(0);
    expect(agingBucketIndex(31)).toBe(1);
    expect(agingBucketIndex(60)).toBe(1);
    expect(agingBucketIndex(61)).toBe(2);
    expect(agingBucketIndex(90)).toBe(2);
    expect(agingBucketIndex(91)).toBe(3);
    expect(agingBucketIndex(500)).toBe(3);
  });

  test("daysPast — التاريخ المستقبل يعامل صفرًا", () => {
    expect(daysPast("2025-06-01", "2025-05-01")).toBe(31);
    expect(daysPast("2025-06-01", "2025-06-01")).toBe(0);
    expect(daysPast("2025-06-01", "2025-07-01")).toBe(0);
    expect(daysPast("باطل", "2025-07-01")).toBe(0);
  });
});

// ==================== ميزان المراجعة ====================

const tbRow = (code: string, type: string, net: number, opening = 0, mDr = 0, mCr = 0): TbAccountRow => ({
  accountId: Number(code),
  code,
  name: `حساب ${code}`,
  type,
  net,
  opening,
  movementDr: mDr,
  movementCr: mCr,
});

describe("ميزان المراجعة", () => {
  test("الصافي الموجب عمود مدين والسالب عمود دائن", () => {
    expect(tbDebitCredit(tbRow("1111", "asset", 500))).toEqual({ debit: 500, credit: 0 });
    expect(tbDebitCredit(tbRow("2111", "liability", -700))).toEqual({ debit: 0, credit: 700 });
    expect(tbDebitCredit(tbRow("2999", "liability", 0))).toEqual({ debit: 0, credit: 0 });
  });

  test("التوازن العام: مجموع العمودين متساوٍ ضمن فلس", () => {
    const rows = [
      tbRow("1111", "asset", 5000),
      tbRow("1121", "asset", 2000),
      tbRow("2111", "liability", -3000),
      tbRow("3100", "equity", -4000),
    ];
    const t = tbTotals(rows);
    expect(t.debit).toBe(7000);
    expect(t.credit).toBe(7000);
    expect(t.diff).toBe(0);
    expect(t.balanced).toBe(true);
  });

  test("الاختلال يُكتشف فوق 0.001", () => {
    const t = tbTotals([tbRow("1111", "asset", 100), tbRow("2111", "liability", -100.002)]);
    expect(t.balanced).toBe(false);
    expect(Math.abs(t.diff)).toBeLessThanOrEqual(0.002);
  });

  test("الملخص بالنوع يجمع الصافي الموقَّع", () => {
    const byType = tbByType([
      tbRow("1111", "asset", 1000),
      tbRow("1121", "asset", -300),
      tbRow("4100", "revenue", -8000),
      tbRow("5210", "expense", 6000),
    ]);
    const asset = byType.find((t) => t.type === "asset");
    const revenue = byType.find((t) => t.type === "revenue");
    expect(asset?.net).toBe(700);
    expect(asset?.count).toBe(2);
    expect(revenue?.net).toBe(-8000);
  });
});

// ==================== تحويلات التصدير ====================

describe("تحويلات ReportTable للتصدير", () => {
  test("glReportTable — رؤوس وصفوف وأعمدة أرقام وإجماليات", () => {
    const rows = buildGlRows(50, [
      { entryNo: 1, entryDate: "2025-05-01", description: "سند قبض", lineDescription: "العميل", debit: 150, credit: 0, sourceType: "voucher" },
      { entryNo: 2, entryDate: "2025-05-02", description: "سند صرف", lineDescription: "صرف", debit: 0, credit: 100, sourceType: "voucher" },
    ]);
    const t = glReportTable({
      accountCode: "1111",
      accountName: "الصندوق",
      from: "2025-05-01",
      to: "",
      rows,
      opening: 50,
      totals: { debit: 150, credit: 100 },
    });
    expect(t.heads).toContain("مدين");
    expect(t.heads).toContain("الرصيد");
    expect(t.numberCols).toEqual([4, 5, 6]);
    expect(t.rows.length).toBe(2);
    expect(t.rows[0][1]).toBe("#1");
    const totals = t.totals as (string | number)[];
    expect(totals[4]).toBe(150);
    expect(totals[5]).toBe(100);
  });

  test("tbReportTable — الإجماليات والملاحظة بالتوازن", () => {
    const rows = [tbRow("1111", "asset", 300, 300, 0, 0), tbRow("2111", "liability", -300, -300, 0, 0)];
    const t = tbReportTable({ asOf: "2025-06-30", rows, totals: tbTotals(rows) });
    const totals = t.totals as (string | number)[];
    expect(totals[4]).toBe(300);
    expect(totals[5]).toBe(300);
    expect(t.note).toContain("متوازن");
  });

  test("agingReportTable — أعمدة الأعمار الأربعة", () => {
    const t = agingReportTable({
      kind: "customers",
      asOf: "2025-06-30",
      rows: [
        { name: "عميل أ", code: "C-1", balance: 900, direction: "debit", buckets: [300, 200, 100, 300], lastActivity: "2025-01-01" },
      ],
      totals: { balance: 900, buckets: [300, 200, 100, 300] },
    });
    expect(t.heads.length).toBe(8);
    expect(t.rows[0][2]).toBe(900);
    const totals = t.totals as (string | number)[];
    expect(totals[6]).toBe(300); // +90
  });

  test("r3 متسق مع نواة القيد", () => {
    expect(r3(1.0004)).toBe(1);
    expect(r3(2.6755)).toBe(2.676);
  });
});
