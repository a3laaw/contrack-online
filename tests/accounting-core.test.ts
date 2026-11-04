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
  suggestAccountForExpenseAccount,
  suggestBridgeLinks,
  xbrlMappingStats,
  type AccountSeedNode,
} from "@/lib/accounting-core";

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

describe("جسر الربط الآلي — شجرة المصروفات → الدليل الجديد", () => {
  const candidates = [
    { id: 1, code: "5220", name: "إيجارات", type: "expense", isLeaf: true, isActive: true },
    { id: 2, code: "5250", name: "قرطاسية ومطبوعات", type: "expense", isLeaf: true, isActive: true },
    { id: 3, code: "1140", name: "عُهد وسلف الموظفين", type: "asset", isLeaf: true, isActive: true },
    { id: 4, code: "5110", name: "مواد وأدوات", type: "expense", isLeaf: true, isActive: false }, // موقوف — لا يُقترح
  ];

  test("تطابق تام للاسم", () => {
    expect(suggestAccountForExpenseAccount("إيجارات", "إيجارات", "expense", candidates)).toBe(1);
  });

  test("تطابق مقطع المسار الأخير", () => {
    expect(suggestAccountForExpenseAccount("قرطاسية", "مصروفات إدارية / قرطاسية ومطبوعات", "expense", candidates)).toBe(2);
  });

  test("حساب السلفة يُقترح من أصول (وليس مصروفات) بالتطابق التام", () => {
    expect(suggestAccountForExpenseAccount("عُهد وسلف الموظفين", "العُهد / عُهد وسلف الموظفين", "advance", candidates)).toBe(3);
  });

  test("الحساب الموقوف لا يُقترح", () => {
    expect(suggestAccountForExpenseAccount("مواد وأدوات", "مشاريع / مواد وأدوات", "expense", candidates)).toBeNull();
  });

  test("بلا مطابقة ⇒ null", () => {
    expect(suggestAccountForExpenseAccount("حساب غريب تمامًا", "حساب غريب تمامًا", "expense", candidates)).toBeNull();
  });

  test("suggestBridgeLinks يعيد اقتراحًا لكل صف", () => {
    const rows = suggestBridgeLinks(
      [
        { id: 100, name: "إيجارات", fullPath: "إيجارات", accountKind: "expense" },
        { id: 101, name: "غير موجود", fullPath: "غير موجود", accountKind: "expense" },
      ],
      candidates
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].suggestedId).toBe(1);
    expect(rows[1].suggestedId).toBeNull();
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
