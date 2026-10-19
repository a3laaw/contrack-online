/**
 * اختبار مصفوفة تقارير العُهد السبعة — قفل سلوك المكتبي V9.15.18 حرفيًا:
 * lifecycle_service.custody_balances/custody_open_items/custody_ledger/
 * custody_detailed_report/custody_monthly_summary/settlements_summary/custody_handover_list
 * السيناريو الذهبي: عهدة «عهدة عامة» — تسليم 1000 (05-01) · تصفية مجموعة
 * ببندين 400+350 (10-01، 12-01) · إرجاع 100 (15-01) ⇒ رصيد 150.
 */

import { describe, expect, test } from "bun:test";
import {
  aggregateBalances,
  buildDetailedRows,
  buildLedgerItems,
  buildMonthlyRows,
  buildOpenItems,
  buildSettlementsSummary,
  filterSearchAndBalance,
  type CustodyLedgerItem,
} from "../src/lib/custody-reports-core";

const ACC = 7; // عهدة عامة
const SNAPSHOT = "عهدة عامة";

// ==================== 1) أرصدة العهد (custody_balances) ====================

describe("aggregateBalances — custody_balances", () => {
  test("السيناريو الذهبي: مُسلَّم 1000 · منفَق 750 · مرتجع 100 ⇒ رصيد 150", () => {
    const rows = aggregateBalances([
      { custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT, vtype: "payment", amount: 1000, expenseGroupRef: "" },
      { custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT, vtype: "payment", amount: 400, expenseGroupRef: "PAY-GRP-20260110-01" },
      { custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT, vtype: "payment", amount: 350, expenseGroupRef: "PAY-GRP-20260110-01" },
      { custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT, vtype: "custody_return", amount: 100, expenseGroupRef: "" },
    ]);
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.accountId).toBe(ACC);
    expect(r.handed).toBe(1000);
    expect(r.spent).toBe(750);
    expect(r.returned).toBe(100);
    expect(r.balance).toBe(150);
    expect(r.handedCount).toBe(1);
    expect(r.spentCount).toBe(2);
    expect(r.returnedCount).toBe(1);
    expect(r.settlements).toBe(1); // مرجع مجموعة واحد مميز
  });

  test("الرصيد يطرح المرتجع أيضًا: balance = handed − spent − returned (3471-3479)", () => {
    const rows = aggregateBalances([
      { custodyAccountId: 1, custodyAccountSnapshot: "أ", vtype: "payment", amount: 500, expenseGroupRef: "" },
      { custodyAccountId: 1, custodyAccountSnapshot: "أ", vtype: "custody_return", amount: 200, expenseGroupRef: "" },
    ]);
    expect(rows[0].balance).toBe(300);
    expect(rows[0].returnedCount).toBe(1);
  });

  test("ترتيب حسب اسم الحساب + مرآة MAX(snapshot) النصية", () => {
    const rows = aggregateBalances([
      { custodyAccountId: 2, custodyAccountSnapshot: "عهدة سيارات", vtype: "payment", amount: 10, expenseGroupRef: "" },
      { custodyAccountId: 1, custodyAccountSnapshot: "عهدة عامة", vtype: "payment", amount: 20, expenseGroupRef: "" },
      { custodyAccountId: 2, custodyAccountSnapshot: "عهدة ب", vtype: "payment", amount: 5, expenseGroupRef: "" },
    ]);
    // ع > س في ترتيب يونيكود ⇒ «عهدة عامة» بعد «عهدة سيارات»
    expect(rows.map((r) => r.accountId)).toEqual([2, 1]);
    expect(rows[0].account).toBe("عهدة سيارات"); // الأعلى نصيًا يفوز كما MAX() في SQL
  });

  test("المرتجع يُجمع بلا شرط مرجع المجموعة والصرف بشرطه (مرآة CASE في SQL)", () => {
    const rows = aggregateBalances([
      { custodyAccountId: 1, custodyAccountSnapshot: "أ", vtype: "custody_return", amount: 70, expenseGroupRef: "X1" },
      { custodyAccountId: 1, custodyAccountSnapshot: "أ", vtype: "payment", amount: 30, expenseGroupRef: "X1" },
    ]);
    expect(rows[0].returned).toBe(70); // custody_return يُجمع حتى بمرجع مجموعة
    expect(rows[0].spent).toBe(30); // payment بمرجع ⇒ منفَق
    expect(rows[0].handed).toBe(0);
    expect(rows[0].settlements).toBe(1);
  });
});

// ==================== 2) العهد المعلقة (custody_open_items) ====================

describe("buildOpenItems — custody_open_items", () => {
  const bals = [
    { accountId: 1, account: "عهدة عامة", handed: 1000, spent: 750, returned: 100, balance: 150, handedCount: 1, spentCount: 2, returnedCount: 1, settlements: 1 },
    { accountId: 2, account: "عهدة مغلقة", handed: 500, spent: 500, returned: 0, balance: 0, handedCount: 1, spentCount: 1, returnedCount: 0, settlements: 1 },
    { accountId: 3, account: "عهدة سالبة", handed: 100, spent: 150, returned: 0, balance: -50, handedCount: 1, spentCount: 1, returnedCount: 0, settlements: 1 },
  ];

  test("المعلقة = رصيد موجب > 0.005 فقط، والأيام من أقدم تسليم حتى asOf (3486-3522)", () => {
    const out = buildOpenItems(bals, [{ accountId: 1, oldest: "2026-01-05", count: 1 }], "2026-01-20");
    expect(out.length).toBe(1);
    expect(out[0].accountId).toBe(1);
    expect(out[0].balance).toBe(150);
    expect(out[0].oldest).toBe("2026-01-05");
    expect(out[0].days).toBe(15);
    expect(out[0].handovers).toBe(1);
  });

  test("رصيد ≤ 0.005 مستبعد حتى لو له تسليمات، والسالب مستبعد (3508)", () => {
    const out = buildOpenItems(bals, [
      { accountId: 2, oldest: "2026-01-01", count: 3 },
      { accountId: 3, oldest: "2026-01-02", count: 2 },
    ], "2026-02-01");
    expect(out.length).toBe(0);
  });

  test("الأيام لا تكون سالبة أبدًا: max(days, 0) (3522)", () => {
    const out = buildOpenItems(bals, [{ accountId: 1, oldest: "2026-06-01", count: 1 }], "2026-01-20");
    expect(out[0].days).toBe(0);
  });

  test("الترتيب: الأيام تنازليًا ثم الاسم (3524)", () => {
    const richer = [
      ...bals,
      { accountId: 4, account: "أبعد", handed: 300, spent: 0, returned: 0, balance: 300, handedCount: 1, spentCount: 0, returnedCount: 0, settlements: 0 },
    ];
    const out = buildOpenItems(richer, [
      { accountId: 1, oldest: "2026-01-05", count: 1 },
      { accountId: 4, oldest: "2025-12-01", count: 2 },
    ], "2026-01-20");
    expect(out.map((o) => o.accountId)).toEqual([4, 1]); // 50 يومًا قبل 15 يومًا
  });
});

// ==================== 3) التصفيات المجمع (settlements_summary) ====================

describe("buildSettlementsSummary — settlements_summary", () => {
  test("السيناريو الذهبي: ترويسة مجموعة + بنودها + البيان بلا تكرار مفصول بـ«،»", () => {
    const res = buildSettlementsSummary(
      [
        { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-10", amount: 400, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
        { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-12", amount: 350, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
      ],
      [
        { expenseGroupRef: "PAY-GRP-20260110-01", voucherNumber: "PV-201", vdate: "2026-01-10", party: "مطارات", expenseAccountSnapshot: "إيجارات", amount: 400, description: "إيجار مكتب يناير" },
        { expenseGroupRef: "PAY-GRP-20260110-01", voucherNumber: "PV-202", vdate: "2026-01-12", party: "مورد الأسمنت", expenseAccountSnapshot: "مواد", amount: 350, description: "شراء أسمنت" },
      ]
    );
    expect(res.count).toBe(1);
    expect(res.total).toBe(750);
    const g = res.rows[0];
    expect(g.vdate).toBe("2026-01-10"); // MIN(vdate)
    expect(g.lines).toBe(2);
    expect(g.total).toBe(750);
    expect(g.custodyAccount).toBe(SNAPSHOT);
    expect(g.description).toBe("إيجار مكتب يناير، شراء أسمنت");
    expect(g.details.length).toBe(2);
  });

  test("البيان المتكرر يُذكر مرة واحدة (V9.15.2 بلا تكرار) والفارغ ⇒ «تصفية عهدة»", () => {
    const res = buildSettlementsSummary(
      [
        { expenseGroupRef: "R1", vdate: "2026-02-01", amount: 100, custodyAccountId: 1, custodyAccountSnapshot: "أ" },
        { expenseGroupRef: "R1", vdate: "2026-02-02", amount: 50, custodyAccountId: 1, custodyAccountSnapshot: "أ" },
      ],
      [
        { expenseGroupRef: "R1", voucherNumber: "PV-1", vdate: "2026-02-01", party: "", expenseAccountSnapshot: "", amount: 100, description: "وقود" },
        { expenseGroupRef: "R1", voucherNumber: "PV-2", vdate: "2026-02-02", party: "", expenseAccountSnapshot: "", amount: 50, description: "وقود" },
      ]
    );
    expect(res.rows[0].description).toBe("وقود");
    const empty = buildSettlementsSummary(
      [{ expenseGroupRef: "R2", vdate: "2026-02-01", amount: 10, custodyAccountId: 1, custodyAccountSnapshot: "أ" }],
      [{ expenseGroupRef: "R2", voucherNumber: "PV-3", vdate: "2026-02-01", party: "", expenseAccountSnapshot: "", amount: 10, description: "" }]
    );
    expect(empty.rows[0].description).toBe("تصفية عهدة");
  });

  test("الترتيب: MIN(vdate) ثم المرجع، والإجمالي مقرّبًا لـ3 خانات", () => {
    const res = buildSettlementsSummary(
      [
        { expenseGroupRef: "R-B", vdate: "2026-03-01", amount: 10.0005, custodyAccountId: 1, custodyAccountSnapshot: "أ" },
        { expenseGroupRef: "R-A", vdate: "2026-02-01", amount: 20, custodyAccountId: 1, custodyAccountSnapshot: "أ" },
      ],
      []
    );
    expect(res.rows.map((r) => r.ref)).toEqual(["R-A", "R-B"]);
    expect(res.total).toBe(30.001); // r3(30.0005) — مطابق لـround(...,3) المكتبي
  });
});

// ==================== 4) الكشف الموحد (custody_ledger) ====================

describe("buildLedgerItems + filterSearchAndBalance — custody_ledger", () => {
  const handovers = [
    { id: 10, voucherNumber: "PV-101", vdate: "2026-01-05", party: "أحمد", description: "تسليم عهدة", amount: 1000, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
  ];
  const groups = [
    { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-10", id: 20, description: "بنود التصفية", amount: 400, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
    { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-12", id: 21, description: "بنود التصفية", amount: 350, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
  ];
  const returns = [
    { id: 30, voucherNumber: "CV-7", vdate: "2026-01-15", party: "", description: "إرجاع المتبقي", amount: 100, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
  ];
  // التفاصيل بترتيب id تنازليًا كما تُرجع list_vouchers (ORDER BY v.id DESC)
  const details = [
    { id: 21, voucherNumber: "PV-202", vdate: "2026-01-12", party: "مورد الأسمنت", description: "شراء أسمنت", amount: 350, expenseAccountSnapshot: "مواد", expenseGroupRef: "PAY-GRP-20260110-01", contractNumber: "CON-009" },
    { id: 20, voucherNumber: "PV-201", vdate: "2026-01-10", party: "مطارات", description: "إيجار مكتب يناير", amount: 400, expenseAccountSnapshot: "إيجارات", expenseGroupRef: "PAY-GRP-20260110-01", contractNumber: "" },
  ];

  test("البيانات: تسليم يضيف «- المستلم» إن لم يكن في البيان (3602-3604)", () => {
    const items = buildLedgerItems(handovers, returns, groups, details);
    const h = items.find((x) => x.kind === "handover")!;
    expect(h.description).toBe("تسليم عهدة - أحمد");
    expect(h.in).toBe(1000);
  });

  test("بيان المستلم الموجود مسبقًا لا يتكرر (شرط not in desc)", () => {
    const items = buildLedgerItems(
      [{ ...handovers[0], description: "عهدة أحمد للجنة" }],
      [], [], []
    );
    expect(items[0].description).toBe("عهدة أحمد للجنة");
  });

  test("بيان التصفية = بنودها بلا تكرار مفصولة بـ«،» بترتيب (التاريخ، رقم السند) (3639-3646)", () => {
    const items = buildLedgerItems(handovers, returns, groups, details);
    const st = items.find((x) => x.kind === "settlement")!;
    expect(st.description).toBe("إيجار مكتب يناير، شراء أسمنت");
    expect(st.out).toBe(750);
    expect(st.detailsCount).toBe(2);
  });

  test("الترتيب الزمني والرصيد التراكمي: 1000 ⇒ 250 ⇒ 150 والإجماليات (3666-3677)", () => {
    const rows = filterSearchAndBalance(buildLedgerItems(handovers, returns, groups, details), "");
    expect(rows.map((r) => r.kind)).toEqual(["handover", "settlement", "return"]);
    expect(rows.map((r) => r.balance)).toEqual([1000, 250, 150]);
    const totalIn = rows.reduce((s, r) => s + r.in, 0);
    const totalOut = rows.reduce((s, r) => s + r.out, 0);
    expect(totalIn).toBe(1000);
    expect(totalOut).toBe(850);
  });

  test("مرآة list_vouchers: بند ملغى في تفاصيل التصفية يظهر في البيان (لا فلتر ملغى في المصدر)", () => {
    const withCancelled = [
      ...details,
      { id: 22, voucherNumber: "PV-203", vdate: "2026-01-13", party: "بائع", description: "بند ملغى", amount: 999, expenseAccountSnapshot: "متفرقات", expenseGroupRef: "PAY-GRP-20260110-01", contractNumber: "" },
    ];
    const items = buildLedgerItems(handovers, returns, groups, withCancelled);
    const st = items.find((x) => x.kind === "settlement")!;
    expect(st.description).toContain("بند ملغى");
    expect(st.details.length).toBe(3); // التفاصيل كما وردت من list_vouchers
    expect(st.detailsCount).toBe(2); // لكن عدد البنود من التجميع (الملغى مستبعد هناك)
  });

  test("البحث بالتطبيع العربي يطابق التفاصيل أيضًا (3654-3665)", () => {
    const rows = filterSearchAndBalance(buildLedgerItems(handovers, returns, groups, details), "اسمنت");
    expect(rows.length).toBe(1); // يطابق عبر بند التصفية «شراء أسمنت» رغم «أسمنت»
    expect(rows[0].kind).toBe("settlement");
    const byRef = filterSearchAndBalance(buildLedgerItems(handovers, returns, groups, details), "CV-7");
    expect(byRef.length).toBe(1);
    expect(byRef[0].kind).toBe("return");
    const none = filterSearchAndBalance(buildLedgerItems(handovers, returns, groups, details), "غير موجود");
    expect(none.length).toBe(0);
  });
});

// ==================== 5) تفصيلي بالحركة (custody_detailed_report) ====================

describe("buildDetailedRows — custody_detailed_report", () => {
  function ledgerFixture(): CustodyLedgerItem[] {
    return filterSearchAndBalance(
      buildLedgerItems(
        [{ id: 10, voucherNumber: "PV-101", vdate: "2026-01-05", party: "أحمد", description: "تسليم عهدة", amount: 1000, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT }],
        [{ id: 30, voucherNumber: "CV-7", vdate: "2026-01-15", party: "", description: "إرجاع المتبقي", amount: 100, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT }],
        [
          { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-10", id: 20, description: "", amount: 400, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
          { expenseGroupRef: "PAY-GRP-20260110-01", vdate: "2026-01-12", id: 21, description: "", amount: 350, custodyAccountId: ACC, custodyAccountSnapshot: SNAPSHOT },
        ],
        [
          { id: 20, voucherNumber: "PV-201", vdate: "2026-01-10", party: "مطارات", description: "إيجار مكتب يناير", amount: 400, expenseAccountSnapshot: "إيجارات", expenseGroupRef: "PAY-GRP-20260110-01", contractNumber: "CON-009" },
          { id: 21, voucherNumber: "PV-202", vdate: "2026-01-12", party: "مورد الأسمنت", description: "شراء أسمنت", amount: 350, expenseAccountSnapshot: "مواد", expenseGroupRef: "PAY-GRP-20260110-01", contractNumber: "" },
        ]
      ),
      ""
    );
  }

  test("كل تصفية تُفكّك لبنودها: المرجع = رقم السند والنوع = «تصفية REF» (3700-3716)", () => {
    const { rows, totals } = buildDetailedRows(ledgerFixture());
    expect(rows.length).toBe(4); // تسليم + بندان + إرجاع
    expect(rows[0].type).toBe("تسليم عهدة");
    expect(rows[0].in).toBe(1000);
    expect(rows[1].ref).toBe("PV-201");
    expect(rows[1].type).toBe("تصفية PAY-GRP-20260110-01");
    expect(rows[1].out).toBe(400);
    expect(rows[1].expense).toBe("إيجارات");
    expect(rows[1].customer).toBe("CON-009");
    expect(rows[2].out).toBe(350);
    expect(rows[3].type).toBe("إرجاع عهدة");
    expect(totals.in).toBe(1000);
    expect(totals.out).toBe(850);
    expect(totals.balance).toBe(150);
  });

  test("الرصيد التراكمي لكل حساب على حدة عند تعدد العهد (3687-3688، 3727-3732)", () => {
    const items: CustodyLedgerItem[] = [
      { kind: "handover", ref: "PV-1", voucherId: 1, vdate: "2026-01-01", description: "أ", in: 100, out: 0, balance: 0, details: [], detailsCount: 0, custodyAccountId: 1, custodyAccount: "عهدة أ" },
      { kind: "handover", ref: "PV-2", voucherId: 2, vdate: "2026-01-02", description: "ب", in: 500, out: 0, balance: 0, details: [], detailsCount: 0, custodyAccountId: 2, custodyAccount: "عهدة ب" },
      { kind: "settlement", ref: "G-A", voucherId: null, vdate: "2026-01-03", description: "صرف أ", in: 0, out: 60, balance: 0, details: [], detailsCount: 1, custodyAccountId: 1, custodyAccount: "عهدة أ" },
      { kind: "settlement", ref: "G-B", voucherId: null, vdate: "2026-01-04", description: "صرف ب", in: 0, out: 400, balance: 0, details: [], detailsCount: 1, custodyAccountId: 2, custodyAccount: "عهدة ب" },
    ];
    const { rows, totals } = buildDetailedRows(items);
    // رصيد «أ»: 100 ⇒ 40 — لا يتأثر بحركة «ب» بينهما
    expect(rows.map((r) => r.balance)).toEqual([100, 500, 40, 100]);
    expect(totals.balance).toBe(140); // 40 + 100 (مجموع أرصدة الحسابات الختامية)
  });

  test("تصفية بلا تفاصيل ⇒ «تصفية (مجمّعة)» (3718-3719)", () => {
    const { rows } = buildDetailedRows([
      { kind: "settlement", ref: "G-X", voucherId: null, vdate: "2026-01-01", description: "قديمة", in: 0, out: 25, balance: 0, details: [], detailsCount: 0, custodyAccountId: 1, custodyAccount: "أ" },
    ]);
    expect(rows[0].type).toBe("تصفية (مجمّعة)");
    expect(rows[0].out).toBe(25);
  });
});

// ==================== 6) الملخص الشهري (custody_monthly_summary) ====================

describe("buildMonthlyRows — custody_monthly_summary", () => {
  const ledger: CustodyLedgerItem[] = filterSearchAndBalance(
    buildLedgerItems(
      [
        { id: 1, voucherNumber: "PV-1", vdate: "2025-12-20", party: "", description: "تسليم ديسمبر", amount: 800, custodyAccountId: 1, custodyAccountSnapshot: "عهدة أ" },
        { id: 2, voucherNumber: "PV-2", vdate: "2026-01-05", party: "", description: "تسليم يناير", amount: 1000, custodyAccountId: 1, custodyAccountSnapshot: "عهدة أ" },
      ],
      [{ id: 3, voucherNumber: "CV-1", vdate: "2026-01-15", party: "", description: "إرجاع", amount: 100, custodyAccountId: 1, custodyAccountSnapshot: "عهدة أ" }],
      [{ expenseGroupRef: "G-1", vdate: "2026-01-10", id: 4, description: "", amount: 750, custodyAccountId: 1, custodyAccountSnapshot: "عهدة أ" }],
      []
    ),
    ""
  );

  test("الافتتاحي = كل ما قبل from، والشهر يتتابع: افتتاحي/تسليم/صرف/مرتجع/ختامي (3754-3790)", () => {
    const { rows, totals } = buildMonthlyRows(ledger, "2026-01-01");
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.month).toBe("2026-01");
    expect(r.account).toBe("عهدة أ");
    expect(r.opening).toBe(800);
    expect(r.handed).toBe(1000);
    expect(r.spent).toBe(750);
    expect(r.returned).toBe(100);
    expect(r.closing).toBe(950);
    expect(totals).toEqual({ handed: 1000, spent: 750, returned: 100 });
  });

  test("بلا from: الافتتاحي صفر وكل الحركة في شهرها", () => {
    const { rows } = buildMonthlyRows(ledger, "");
    expect(rows.map((r) => r.month)).toEqual(["2025-12", "2026-01"]);
    expect(rows[0].opening).toBe(0);
    expect(rows[0].closing).toBe(800);
    expect(rows[1].opening).toBe(800);
    expect(rows[1].closing).toBe(950);
  });

  test("حسابان يُعرضان منفصلين مرتبين بالاسم وكل منهما برصيده (3776-3790)", () => {
    const two: CustodyLedgerItem[] = [
      { kind: "handover", ref: "PV-B", voucherId: 2, vdate: "2026-01-15", description: "", in: 500, out: 0, balance: 0, details: [], detailsCount: 0, custodyAccountId: 2, custodyAccount: "عهدة ب" },
      { kind: "handover", ref: "PV-A", voucherId: 1, vdate: "2026-01-01", description: "", in: 200, out: 0, balance: 0, details: [], detailsCount: 0, custodyAccountId: 1, custodyAccount: "عهدة أ" },
      { kind: "settlement", ref: "G-A", voucherId: null, vdate: "2026-02-20", description: "", in: 0, out: 50, balance: 0, details: [], detailsCount: 1, custodyAccountId: 1, custodyAccount: "عهدة أ" },
    ];
    const { rows } = buildMonthlyRows(two, "");
    expect(rows.map((r) => r.account)).toEqual(["عهدة أ", "عهدة أ", "عهدة ب"]);
    expect(rows[1].closing).toBe(150);
    expect(rows[2].closing).toBe(500);
  });
});
