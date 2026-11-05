/**
 * اختبارات نواة المحاسبة (accounting-core) — Task 102/103:
 *   - سلامة دليل الحسابات الكويتي المُبذَّر (أكواد فريدة، قواعد الشجرة، الطبيعة، خريطة XBRL)
 *   - قواعد التحقق لإنشاء/تعديل الحسابات (checkAccountMutation)
 *   - جسر الربط الآلي بين شجرة المصروفات القديمة والدليل الجديد
 *   - ميزان الأرصدة الافتتاحية وصيغة التوقيع (مدين موجب/دائن سالب)
 *   - صيغة عنصر XBRL وإحصاءات الخريطة
 * التشغيل: bun test tests/accounting-core.test.ts
 */
import { describe, expect, test } from "bun:test";

import {
  ACCOUNT_SEED,
  checkAccountMutation,
  checkOpeningBalance,
  countSeedLeaves,
  defaultNatureForType,
  isValidAccountCode,
  isValidXbrlElement,
  openingBalanceSigned,
  xbrlMappingStats,
  type AccountSeedNode,
} from "@/lib/accounting-core";
import {
  planTreeMerge,
  planVoucherFieldMigration,
  resolveMergeMap,
  verifyFieldMigration,
} from "@/lib/accounting-merge-core";

// ==================== مساعدات فحص الشجرة ====================

function flattenSeed(nodes: AccountSeedNode[], parentType?: string, parentCode?: string): {
  node: AccountSeedNode;
  parentType?: string;
  parentCode?: string;
}[] {
  const out: { node: AccountSeedNode; parentType?: string; parentCode?: string }[] = [];
  for (const n of nodes) {
    out.push({ node: n, parentType, parentCode });
    if (n.children?.length) out.push(...flattenSeed(n.children, n.type, n.code));
  }
  return out;
}

const FLAT = flattenSeed(ACCOUNT_SEED);
const LEAVES = FLAT.filter((f) => !f.node.children?.length || f.node.children.length === 0);
const PARENTS = FLAT.filter((f) => f.node.children && f.node.children.length > 0);

describe("دليل الحسابات الكويتي المُبذَّر — سلامة البنية", () => {
  test("الأكواد فريدة عبر الشجرة كاملة", () => {
    const codes = FLAT.map((f) => f.node.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("الأكواد أرقام 3–8 خانات وتوافق بادئة النوع", () => {
    for (const { node } of FLAT) {
      expect(isValidAccountCode(node.code)).toBe(true);
      const prefix = node.type === "asset" ? "1" : node.type === "liability" ? "2" : node.type === "equity" ? "3" : node.type === "revenue" ? "4" : "5";
      expect(node.code.startsWith(prefix)).toBe(true);
    }
  });

  test("الابن يرث نوع الأب حصرًا — لا أصل تحت التزامات", () => {
    for (const f of FLAT) {
      if (f.parentType) expect(f.node.type).toBe(f.parentType);
    }
  });

  test("العقدة ذات الأبناء ليست ورقة والورقة بلا أبناء", () => {
    // الأب لا يعلن نفسه ورقة أبدًا (الاشتقاق وقت البذر يجعل leaf=false لمن له أبناء)
    for (const p of PARENTS) {
      expect(p.node.leaf !== true).toBe(true);
    }
    for (const l of LEAVES) {
      expect(!l.node.children?.length).toBe(true);
      expect(l.node.leaf ?? true).toBe(true);
    }
  });

  test("الطبيعة تُشتق من النوع إلا الاستثناء المخالف الموثق (مجمع الإهلاك)", () => {
    const EXCEPTIONS = new Set(["1220"]); // مجمع إهلاك الأصول الثابتة — أصل دائن
    for (const { node } of FLAT) {
      const derived = node.nature ?? defaultNatureForType(node.type);
      if (EXCEPTIONS.has(node.code)) {
        expect(derived).toBe("credit");
        expect(node.type).toBe("asset");
      } else {
        expect(derived).toBe(defaultNatureForType(node.type));
      }
    }
  });

  test("كل ورقة تستقبل القيود افتراضيًا (allowPosting)", () => {
    for (const l of LEAVES) {
      expect(l.node.allowPosting ?? true).toBe(true);
    }
  });

  test("countSeedLeaves يطابق عدد الأوراق فعليًا", () => {
    expect(countSeedLeaves()).toBe(LEAVES.length);
  });

  test("الخمس شعارات القوائم مغطاة (أصول/التزامات/حقوق/إيرادات/مصروفات)", () => {
    const codes = new Set(FLAT.map((f) => f.node.code));
    for (const root of ["1000", "2000", "3000", "4000", "5000"]) {
      expect(codes.has(root)).toBe(true);
    }
  });
});

describe("خريطة XBRL الكويتي — جاهزية التقديم الإلكتروني", () => {
  test("كل ورقة مُبذَّرة تحمل عنصر XBRL بنسبة 100%", () => {
    const unmapped = LEAVES.filter((l) => !l.node.xbrl);
    expect(unmapped.map((l) => l.node.code)).toEqual([]);
  });

  test("العناصر الأساسية لقوائم IFRS موجودة (المركز/الدخل)", () => {
    const elements = new Set(FLAT.map((f) => f.node.xbrl));
    for (const el of [
      "ifrs-full:Assets",
      "ifrs-full:Liabilities",
      "ifrs-full:Equity",
      "ifrs-full:Revenue",
      "ifrs-full:CashAndCashEquivalents",
      "ifrs-full:RetainedEarnings",
      "ifrs-full:IssuedCapital",
    ]) {
      expect(elements.has(el)).toBe(true);
    }
  });

  test("العناصر الكويتية الخاصة موجودة: الزكاة (قانون 8/2019) والمحتجزات والباطن", () => {
    const elements = new Set(FLAT.map((f) => f.node.xbrl));
    for (const el of ["kw:ZakatExpense", "kw:ZakatPayable", "kw:CustomerRetentionsReceivable", "kw:SubcontractorRetentionsPayable"]) {
      expect(elements.has(el)).toBe(true);
    }
  });

  test("شكل العنصر الصحيح namespace:element — ويُرفض ما خالفه", () => {
    expect(isValidXbrlElement("ifrs-full:Assets")).toBe(true);
    expect(isValidXbrlElement("kw:ZakatExpense")).toBe(true);
    expect(isValidXbrlElement("Assets")).toBe(false);
    expect(isValidXbrlElement("ifrs-full:")).toBe(false);
    expect(isValidXbrlElement("ifrs full:Assets")).toBe(false);
    expect(isValidXbrlElement("")).toBe(false);
  });

  test("إحصاءات الخريطة تحسب الموصولة وغير الموصولة والعناصر الفريدة", () => {
    const stats = xbrlMappingStats([
      { code: "1111", name: "الصندوق", type: "asset", xbrlElement: "kw:CashOnHand" },
      { code: "1112", name: "البنك", type: "asset", xbrlElement: "kw:CashOnHand" },
      { code: "5399", name: "حساب جديد", type: "expense", xbrlElement: "" },
    ]);
    expect(stats.leavesTotal).toBe(3);
    expect(stats.leavesMapped).toBe(2);
    expect(stats.unmappedCodes).toEqual(["5399"]);
    expect(stats.uniqueElements).toEqual(["kw:CashOnHand"]);
  });
});

describe("قواعد التحقق — checkAccountMutation", () => {
  test("إنشاء سليم: الاسم والكود والنوع مع اشتقاق الطبيعة تلقائيًا", () => {
    const r = checkAccountMutation({ code: "5270", name: "ضيافة واستقبال", type: "expense" });
    expect(r.ok).toBe(true);
    expect(r.nature).toBe("debit");
    expect(r.code).toBe("5270");
  });

  test("الطبيعة الصريحة تُحترم (إيراد بطبيعة مدين لمعالجة يدوية غير مسموح تلقائيًا لكنه صيغة صالحة)", () => {
    const r = checkAccountMutation({ code: "4400", name: "تسويات إيرادات", type: "revenue", nature: "debit" });
    expect(r.ok).toBe(true);
    expect(r.nature).toBe("debit");
  });

  test("رفض الاسم الفارغ والكود غير الرقمي والكود القصير", () => {
    expect(checkAccountMutation({ code: "5270", name: "", type: "expense" }).ok).toBe(false);
    expect(checkAccountMutation({ code: "5A70", name: "غلط", type: "expense" }).ok).toBe(false);
    expect(checkAccountMutation({ code: "52", name: "قصير", type: "expense" }).ok).toBe(false);
  });

  test("رفض كود لا يوافق بادئة النوع", () => {
    const r = checkAccountMutation({ code: "9900", name: "حساب غريب", type: "asset" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("1");
  });

  test("رفض ابن بنوع مخالف لأبيه", () => {
    const r = checkAccountMutation({ code: "5110", name: "مواد", type: "expense", parentType: "liability" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("يرث");
  });

  test("الحساب النظامي: تغيير الكود أو النوع مرفوض والتعديل السليم يقبل", () => {
    const existing = { code: "1111", type: "asset" as const, nature: "debit" as const, isSystem: true };
    expect(checkAccountMutation({ code: "9999" }, existing).ok).toBe(false);
    expect(checkAccountMutation({ type: "liability" }, existing).ok).toBe(false);
    const okRename = checkAccountMutation({ name: "الصندوق النقدي" }, existing);
    expect(okRename.ok).toBe(true);
    expect(okRename.nature).toBe("debit");
  });
});

describe("دمج الشجرتين — planTreeMerge + تحويل السندات (Task 105)", () => {
  const chart = [
    { id: 1, code: "5220", name: "إيجارات", type: "expense", isLeaf: true, isActive: true },
    { id: 2, code: "5250", name: "قرطاسية ومطبوعات", type: "expense", isLeaf: true, isActive: true },
    { id: 3, code: "1140", name: "عُهد وسلف الموظفين", type: "asset", isLeaf: true, isActive: true },
  ];

  test("الجسر المعتمد يدويًا يفوز أولًا ويضبط includeInProfitability للمصروف", () => {
    const plan = planTreeMerge(
      [{ id: 100, parentId: null, name: "إيجار بنكي", fullPath: "إيجار بنكي", isActive: true, allowPosting: true, includeInProfitability: false, accountKind: "expense", accountId: 1 }],
      chart,
      new Set([100]),
      new Set(),
    );
    expect(plan.links).toEqual([{ eaId: 100, accountId: 1, method: "bridge" }]);
    expect(plan.creates).toHaveLength(0);
    expect(plan.profitabilityOnExisting).toEqual([{ accountId: 1, includeInProfitability: false }]);
  });

  test("مطابقة الاسم التامة تربط دون إنشاء والعهدة المستهدفة تضبط custody", () => {
    const plan = planTreeMerge(
      [{ id: 101, parentId: null, name: "عهدة عامة", fullPath: "العُهد / عهدة عامة", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "advance", accountId: 3 }],
      chart,
      new Set(),
      new Set([101]),
    );
    expect(plan.links).toEqual([{ eaId: 101, accountId: 3, method: "bridge" }]);
    expect(plan.custodyRoleOnExisting).toEqual([3]);
  });

  test("حساب مصروف مستخدم غير مطابق ⇒ إنشاء تحت 5300 بأكواد تسلسلية 530001+", () => {
    const plan = planTreeMerge(
      [
        { id: 200, parentId: null, name: "بنزين", fullPath: "تشغيلية / بنزين", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "expense" },
        { id: 201, parentId: null, name: "رسوم بلدية", fullPath: "تشغيلية / رسوم بلدية", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "expense" },
      ],
      chart,
      new Set([200, 201]),
      new Set(),
    );
    expect(plan.creates.map((c) => ({ eaId: c.eaId, parentCode: c.parentCode, code: c.code, type: c.type, role: c.accountRole }))).toEqual([
      { eaId: 200, parentCode: "5300", code: "530001", type: "expense", role: "standard" },
      { eaId: 201, parentCode: "5300", code: "530002", type: "expense", role: "standard" },
    ]);
    expect(plan.leafToBranchCodes).toEqual(["5300"]);
  });

  test("عهدة غير مطابقة تُنشأ تحت 1140 بـrole=custody — ولا دمج جماعي في 1140", () => {
    const plan = planTreeMerge(
      [{ id: 300, parentId: null, name: "عهدة المهندس", fullPath: "العُهد / عهدة المهندس", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "advance" }],
      chart,
      new Set(),
      new Set([300]),
    );
    expect(plan.creates[0]).toMatchObject({ parentCode: "1140", code: "114001", type: "asset", accountRole: "custody" });
  });

  test("غير المستخدم في سندات يُهمل ويُوثق — والدليل نظيف", () => {
    const plan = planTreeMerge(
      [{ id: 400, parentId: null, name: "إعلانات قديمة", fullPath: "تسويق / إعلانات", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "expense" }],
      chart,
      new Set(),
      new Set(),
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
    expect(plan.skipped).toEqual([{ eaId: 400, name: "إعلانات قديمة", reason: "حساب مصروف غير مستخدم في سندات" }]);
  });

  test("تحويل السندات: تصفية تحفظ طرفيها وhandover يجعل العهدة رئيسية وsnapshot مدمج", () => {
    const plan = planTreeMerge(
      [
        { id: 500, parentId: null, name: "بنزين", fullPath: "ب", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "expense" },
        { id: 501, parentId: null, name: "عهدة عامة", fullPath: "ع", isActive: true, allowPosting: true, includeInProfitability: true, accountKind: "advance" },
      ],
      chart,
      new Set([500]),
      new Set([501]),
    );
    const map = resolveMergeMap(plan, [
      { eaId: 500, accountId: 90 },
      { eaId: 501, accountId: 91 },
    ]);
    const names = new Map([[90, "بنزين / وقود"], [91, "عهدة عامة"]]);
    const { updates, unresolved } = planVoucherFieldMigration(
      [
        { id: 1, expenseAccountId: 500, custodyAccountId: 501, expenseAccountSnapshot: "بنزين", custodyAccountSnapshot: "عهدة عامة" }, // تصفية
        { id: 2, expenseAccountId: null, custodyAccountId: 501, expenseAccountSnapshot: "", custodyAccountSnapshot: "عهدة عامة" }, // handover
        { id: 3, expenseAccountId: null, custodyAccountId: null, expenseAccountSnapshot: "", custodyAccountSnapshot: "" }, // قبض — بلا حساب
      ],
      map,
      names,
    );
    expect(unresolved).toHaveLength(0);
    expect(updates).toEqual([
      { id: 1, accountId: 90, custodyAccountId: 91, accountSnapshot: "بنزين" },
      { id: 2, accountId: 91, custodyAccountId: 91, accountSnapshot: "عهدة عامة" },
    ]);
    // تحقق الفحوص: كل حالة سليمة
    const check = verifyFieldMigration(
      [
        { id: 1, expenseAccountId: 500, custodyAccountId: 501, expenseAccountSnapshot: "", custodyAccountSnapshot: "" },
        { id: 2, expenseAccountId: null, custodyAccountId: 501, expenseAccountSnapshot: "", custodyAccountSnapshot: "" },
      ],
      updates,
    );
    expect(check.ok).toBe(true);
  });

  test("فحص الفشل: تصفية فقدت طرفًا تُكتشف", () => {
    const check = verifyFieldMigration(
      [{ id: 7, expenseAccountId: 5, custodyAccountId: 6, expenseAccountSnapshot: "", custodyAccountSnapshot: "" }],
      [{ id: 7, accountId: 90, custodyAccountId: null, accountSnapshot: null }],
    );
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toContain("7");
  });
});

describe("الأرصدة الافتتاحية — Task 103", () => {
  test("التوقيع: مدين موجب ودائن سالب", () => {
    expect(openingBalanceSigned("debit", 500)).toBe(500);
    expect(openingBalanceSigned("credit", 500)).toBe(-500);
    expect(openingBalanceSigned("debit", -500)).toBe(500); // القيمة المطلقة دائمًا
  });

  test("ميزان متوازن: مجموع المدين = مجموع الدائن", () => {
    const r = checkOpeningBalance([
      { code: "1111", name: "الصندوق", type: "asset", nature: "debit", openingBalance: 1000 },
      { code: "3100", name: "رأس المال", type: "equity", nature: "credit", openingBalance: -1000 },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.diff).toBe(0);
    expect(r.totalDebit).toBe(1000);
    expect(r.totalCredit).toBe(1000);
  });

  test("فرق غير متوازن يُحسب بحدود 0.001", () => {
    const r = checkOpeningBalance([
      { code: "1111", name: "الصندوق", type: "asset", nature: "debit", openingBalance: 1000.001 },
      { code: "3100", name: "رأس المال", type: "equity", nature: "credit", openingBalance: -1000 },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.diff).toBe(0.001);
  });

  test("الأوراق وحدها تلخّص الدليل المُبذَّر متوازنًا عند صفريّة الأرصدة الافتراضية", () => {
    const rows = LEAVES.map((l) => ({
      code: l.node.code,
      name: l.node.name,
      type: l.node.type as never,
      nature: (l.node.nature ?? defaultNatureForType(l.node.type)) as never,
      openingBalance: 0,
    }));
    const r = checkOpeningBalance(rows);
    expect(r.balanced).toBe(true);
  });
});
