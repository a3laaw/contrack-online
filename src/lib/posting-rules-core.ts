/**
 * posting-rules-core.ts — نواة قواعد ترحيل السندات النقية (بلا React ولا server-only) — Task 106.
 * قرار هيكلي (docs/roadmap-accounting.md Task 106): «PostingRule: قوالب قيود لكل نوع سند
 * (قبض، صرف مصروف، صرف استحقاق عقد، صرف باطن، عهدة، إرجاع عهدة، خصم راتب، رسوم بوابة) —
 * قابلة للضبط في إعدادات الشركة مع بذر افتراضي سليم».
 *
 * سلسلة الحسم لطرف القيد (أولوية صارمة موحدة):
 *   1) الاختيار الصريح للسند (accountId/custodyAccountId من الدليل الموحد)
 *   2) كود القاعدة القابل للضبط (PostingRule.debitCode/creditCode إن لم يكن فارغًا)
 *   3) الافتراضي المدمج (builtinVoucherSideName — مرآة منطق Task 105 حرفيًا)
 *   4) حساب التسوية المؤقت (الشك — عبر الحاسم النصي في postNamedEntry)
 *
 * البذرة الافتراضية أكوادها الفارغة للأطراف السياقية — فسلوك النظام قبل/بعد
 * Task 106 متطابق حرفيًا حتى بلا أي ضبط، والضبط يبدأ فقط حين يثبّت المدير كودًا.
 */

// ==================== كتالوج القواعد ====================

export type PostingRuleGroup = "receipt" | "payment" | "custody" | "invoice" | "other";

export interface PostingRuleDef {
  /** مفتاح القاعدة — يخزَّن في PostingRule.ruleKey */
  key: string;
  /** التسمية المعروضة */
  label: string;
  /** المجموعة للعرض في شاشة الإعدادات */
  group: PostingRuleGroup;
  /** كود الطرف المدين الافتراضي في البذرة — فارغ = سياقي (يُحسم من السند) */
  defaultDebitCode: string;
  /** كود الطرف الدائن الافتراضي في البذرة — فارغ = سياقي */
  defaultCreditCode: string;
  /** هل يُسمح تثبيت كود المدين من الإعدادات (جانب له معنى ثابتًا) */
  debitAdjustable: boolean;
  /** هل يُسمح تثبيت كود الدائن */
  creditAdjustable: boolean;
  /** شرح جانب الحسم — يظهر في شاشة الإعدادات */
  description: string;
}

/**
 * الكتالوج المرجعي — مرآة منطق القيود المدمج (insertVoucherJournal + الرسوم البنكية)
 * بأصناف السندات التسعة. أكواد الأطراف الثابتة فطريًا فقط تُبذر مثبتة
 * (خصم راتب: رواتب/سلف موظفين — رسوم بوابة: 5260)، والبقية سياقية فارغة.
 */
export const POSTING_RULE_CATALOG: PostingRuleDef[] = [
  {
    key: "receipt",
    label: "سند قبض",
    group: "receipt",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: true,
    description:
      "المدين: نقد/بنك حسب طريقة التحصيل. الدائن: إيرادات العقود إن رُبط بعقد وإلا العملاء — التثبيت يفرض الحساب على كل القبض.",
  },
  {
    key: "payment_expense",
    label: "صرف مصروف",
    group: "payment",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description:
      "المدين: الحساب المختار في السند من الدليل (وإلا الاسم النصي المحسوم). الدائن: نقد/بنك حسب طريقة الصرف.",
  },
  {
    key: "payment_contract_due",
    label: "صرف استحقاق عقد",
    group: "payment",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description:
      "صرف مرتبط بعقد عميل بلا حساب مختار ولا باطن — المدين: الحساب المختار أو المثبّت هنا. الدائن: نقد/بنك.",
  },
  {
    key: "payment_subcontract",
    label: "صرف باطن",
    group: "payment",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description:
      "صرف على عقد باطن — المدين: الحساب المختار أو المثبّت هنا (مثل تكلفة الأعمال 5120). الدائن: نقد/بنك.",
  },
  {
    key: "payment_partner",
    label: "صرف شريك (جاري)",
    group: "payment",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description: "صرف لطرف شريك — المدين: جاري الشريك (3400) افتراضيًا أو المثبّت هنا. الدائن: نقد/بنك.",
  },
  {
    key: "custody_handover",
    label: "تسليم عهدة",
    group: "custody",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: false,
    creditAdjustable: false,
    description:
      "المدين: حساب العهدة/السلفة المختار في السند (أصل من الدليل) — لا يُثبَّت. الدائن: نقد/بنك حسب طريقة الصرف.",
  },
  {
    key: "custody_settlement",
    label: "تصفية عهدة",
    group: "custody",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description:
      "المدين: حساب المصروف/العميل المختار ببند التصفية. الدائن: حساب العهدة (يُنشر مباشرة من وحدة العهد) — التثبيت للمدين الاحتياطي فقط.",
  },
  {
    key: "custody_return",
    label: "إرجاع عهدة",
    group: "custody",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: false,
    creditAdjustable: false,
    description: "المدين: نقد/بنك (يدخل الخزينة). الدائن: حساب العهدة المختار في السند — لا يُثبَّت.",
  },
  {
    key: "salary_deduction",
    label: "خصم راتب",
    group: "other",
    defaultDebitCode: "5210",
    defaultCreditCode: "1140",
    debitAdjustable: true,
    creditAdjustable: true,
    description: "المدين: رواتب وأجور (5210). الدائن: عُهد وسلف الموظفين (1140) — الطرفان مثبتان افتراضيًا وقابلان للضبط.",
  },
  {
    key: "transfer",
    label: "تحويل صندوق ↔ بنك",
    group: "other",
    defaultDebitCode: "",
    defaultCreditCode: "",
    debitAdjustable: false,
    creditAdjustable: false,
    description: "المدين: الحساب المستلَم إليه، الدائن: الحساب المُحوَّل منه — كلاهما من السند نفسه (سياقي دائمًا).",
  },
  {
    key: "bank_fee",
    label: "رسوم بوابة بنكية",
    group: "other",
    defaultDebitCode: "5260",
    defaultCreditCode: "",
    debitAdjustable: true,
    creditAdjustable: false,
    description: "المدين: رسوم وعمولات بنكية (5260) — قابل للتثبيت. الدائن: حساب السند الأب (نقد/بنك).",
  },
  {
    // Task 107 — قيد إصدار الفاتورة عبر القواعد المعلنة (مبدأ «المستند بلا قيد = مسودة»)
    key: "invoice_issue",
    label: "إصدار فاتورة",
    group: "invoice",
    defaultDebitCode: "1121",
    defaultCreditCode: "4100",
    debitAdjustable: true,
    creditAdjustable: true,
    description:
      "قيد إصدار الفاتورة — المدين: ذمم العملاء (1121)، الدائن: إيرادات العقود (4100) — الطرفان قابلان للضبط. سداد الفاتورة بسند قبض يدخل دائنًا على حساب المدين هنا. الإلغاء/التعديل بقيد عكسي مرتبط آليًا.",
  },
];

/** خريطة الكتالوج بالمفتاح — للوصول السريع */
export const POSTING_RULE_BY_KEY: ReadonlyMap<string, PostingRuleDef> = new Map(
  POSTING_RULE_CATALOG.map((d) => [d.key, d])
);

export const POSTING_RULE_GROUP_LABEL: Record<PostingRuleGroup, string> = {
  receipt: "القبض",
  payment: "الصرف",
  custody: "العهد والسلف",
  invoice: "الفواتير",
  other: "أخرى",
};

// ==================== حسم مفتاح القاعدة من سياق السند ====================

/** السياق الأدنى الذي يحسم صنف السند — يُبنى من صف Voucher قبل النشر */
export interface VoucherRuleContext {
  vtype: string; // receipt | payment | transfer | custody_return | salary_deduction
  partyType?: string; // "" | customer | subcontractor | partner | transfer
  hasAccountId?: boolean;
  hasCustodyAccountId?: boolean;
  hasSubContractId?: boolean;
  hasContractId?: boolean;
  hasExpenseGroupRef?: boolean; // مرجع مجموعة تصفية (PAY-GRP-…)
}

/**
 * مفتاح قاعدة الترحيل لصنف السند — مرآة قرارات insertVoucherJournal:
 *  • الصرف لشريك قبل فحص العهد (الشريك لا عهدة له)
 *  • تصفية العهدة: عهدة + حساب مصروف معًا
 *  • تسليم العهدة: عهدة بلا حساب مصروف
 *  • الباطن قبل استحقاق العقد (أدق سياقًا)
 * مفتاح غير معروف ⇒ "" — يبقى النشر بالمسار النصي المدمج كما كان.
 */
export function resolveRuleKeyForVoucher(ctx: VoucherRuleContext): string {
  switch (ctx.vtype) {
    case "receipt":
      return "receipt";
    case "custody_return":
      return "custody_return";
    case "salary_deduction":
      return "salary_deduction";
    case "transfer":
      return "transfer";
    case "payment":
      if ((ctx.partyType || "") === "partner") return "payment_partner";
      if (ctx.hasCustodyAccountId && ctx.hasAccountId) return "custody_settlement";
      if (ctx.hasCustodyAccountId) return "custody_handover";
      if (ctx.hasSubContractId) return "payment_subcontract";
      if (ctx.hasContractId) return "payment_contract_due";
      return "payment_expense";
    default:
      return "";
  }
}

// ==================== الافتراضي المدمج لأطراف القيد ====================

/** سياق الطرف المدمج — نصوص السند الحرمة كما تصل من الواجهة */
export interface BuiltinSideContext {
  method: string; // طريقة الدفع («نقدية»/«بنك — كي نت»…)
  account: string; // نص الحساب الحر للسند (الصندوق/البنك/أي اسم)
  snapshot: string; // اسم الحساب عند التسجيل (لصرف المصروفات)
  partyType: string;
  hasContractId?: boolean; // قبض مرتبط بعقد → إيرادات العقود وإلا العملاء
}

/** الافتراضي المدمج لاسم طرف المدين — مرآة switch النشر الحالي حرفيًا (Task 105) */
export function builtinDebitName(vtype: string, ctx: BuiltinSideContext): string {
  switch (vtype) {
    case "receipt":
      return ctx.account || builtinCashAccountForMethod(ctx.method);
    case "payment":
      return ctx.snapshot || ((ctx.partyType || "") === "partner" ? "جاري الشريك" : "مصروفات أخرى");
    case "transfer":
      return ctx.account || "بنك";
    case "custody_return":
      return ctx.account || builtinCashAccountForMethod(ctx.method);
    case "salary_deduction":
      return "رواتب";
    default:
      return "";
  }
}

/** الافتراضي المدمج لاسم طرف الدائن — مرآة switch النشر الحالي حرفيًا (Task 105) */
export function builtinCreditName(vtype: string, ctx: BuiltinSideContext): string {
  switch (vtype) {
    case "receipt":
      return ctx.hasContractId ? "إيرادات العقود" : "العملاء";
    case "payment":
      return ctx.account || builtinCashAccountForMethod(ctx.method);
    case "transfer":
      return ctx.method || "صندوق";
    case "custody_return":
      return ctx.snapshot || "العهد";
    case "salary_deduction":
      return "سلف موظفين";
    default:
      return "";
  }
}

/** طريقة الدفع → الحساب النقدي الافتراضي (مرآة defaultAccountForMethod) */
export function builtinCashAccountForMethod(method: string): string {
  const m = (method || "").toLowerCase();
  if (
    (method || "").includes("بنك") ||
    (method || "").includes("حوالة") ||
    (method || "").includes("تحويل") ||
    m.includes("knet") ||
    m.includes("bank")
  ) {
    return "بنك";
  }
  return "صندوق";
}

// ==================== سلسلة الحسم للطرف الواحد ====================

/** مرشّح حساب الدليل كما يمر إلى الحاسم */
export interface RuleChartAccount {
  id: number;
  code: string;
  name: string;
  allowPosting: boolean;
  isActive: boolean;
}

export interface SideResolutionInput {
  /** 1) الاختيار الصريح — id من الدليل الموحد (accountId/custodyAccountId) */
  explicitAccountId?: number | null;
  /** 2) كود القاعدة القابل للضبط (فارغ = سياقي) */
  ruleCode?: string;
  /** 3) الاسم المدمج السياقي (يُحسم نصيًا كالسابق) */
  builtinName: string;
}

export interface SideResolution {
  accountId: number | null;
  /** مصدر الحسم — للتوثيق في وصف السطر والتشخيص */
  source: "explicit" | "rule" | "builtin";
  name: string;
}

/**
 * حسم طرف القيد الواحد بالأولوية الصارمة:
 * صريح → كود القاعدة (إن كان حسابًا ورقيًا نشطًا) → الاسم المدمج (يعود null
 * والخادم يمرره للحاسم النصي/التسوية عبر postNamedEntry كالسابق).
 */
export function resolvePostingSide(
  input: SideResolutionInput,
  chart: RuleChartAccount[]
): SideResolution | null {
  const byId = new Map(chart.map((a) => [a.id, a]));
  const byCode = new Map(chart.map((a) => [a.code, a]));

  const ok = (a?: RuleChartAccount | null): a is RuleChartAccount =>
    !!a && a.isActive && a.allowPosting;

  // 1) الاختيار الصريح للسند
  if (input.explicitAccountId != null) {
    const acc = byId.get(input.explicitAccountId);
    if (ok(acc)) return { accountId: acc.id, source: "explicit", name: acc.name };
  }

  // 2) كود القاعدة القابل للضبط
  const code = String(input.ruleCode || "").trim();
  if (code) {
    const acc = byCode.get(code);
    if (ok(acc)) return { accountId: acc.id, source: "rule", name: acc.name };
  }

  // 3) الاسم المدمج — يُحسم نصيًا (الدليل/الخريطة الثابتة) في الخادم
  const name = String(input.builtinName || "").trim();
  if (!name) return null;
  return { accountId: null, source: "builtin", name };
}

// ==================== بذرة الكود القابل للنشر (كل شركة) ====================

/**
 * حسم الكود الافتراضي القابل للنشر في سياق شركة بعينها — Task 106.
 * الأزرق (blueprintCode) قد يصبح إجماليًا بعد ترحيلات الدليل (Task 105: 1140→114001،
 * 5300→530001) — فالبذرة لا تثبّت كودًا لا يقبل النشر:
 *   1) الكود نفسه إن كان ورقة نشطة تقبل النشر
 *   2) أعمق ورقة نشطة تقبل النشر كودها يبدأ بالكود الأزرق (ابن مُنشأ بالترحيل)
 *   3) فارغ (سياقي) — لا تثبيت فاشل
 * مرشّحات الدليل تُمرّر من سياق الشركة المُبذِّر (سجلّاتها فقط).
 */
export interface SeedChartAccount {
  code: string;
  isLeaf: boolean;
  allowPosting: boolean;
  isActive: boolean;
}

export function resolveSeedableCode(blueprintCode: string, accounts: SeedChartAccount[]): string {
  const bp = String(blueprintCode || "").trim();
  if (!bp) return "";
  const postable = accounts.filter((a) => a.isActive && a.allowPosting && a.isLeaf);
  const exact = postable.find((a) => a.code === bp);
  if (exact) return exact.code;
  const descendants = postable.filter((a) => a.code.startsWith(bp));
  if (descendants.length > 0) {
    // الأعمق (أطول كود) — إن تعددت تُختار الأصغر ترتيبًا للأطول (استقرار البذرة)
    return descendants.sort((a, b) => b.code.length - a.code.length || a.code.localeCompare(b.code))[0].code;
  }
  return "";
}

// ==================== تحقق إدخال الإعدادات ====================

export interface PostingRuleUpdateInput {
  ruleKey?: unknown;
  debitCode?: unknown;
  creditCode?: unknown;
  enabled?: unknown;
}

export interface PostingRuleUpdateCheck {
  ok: boolean;
  error?: string;
  ruleKey?: string;
  debitCode?: string;
  creditCode?: string;
  enabled?: boolean;
}

/**
 * تحقق سطر قاعدة قادم من شاشة الإعدادات:
 *  • ruleKey من الكتالوج حصرًا
 *  • الكود فارغ (سياقي) أو حساب موجود في الدليل — الورقية/النشطة الوحيدة المقبولة تثبيتًا
 *  • قاعدة غير قابلة للتثبيت ترفض الكود (العهد والتحويل سياقيان دائمًا)
 */
export function checkPostingRuleUpdate(
  input: PostingRuleUpdateInput,
  def: PostingRuleDef | undefined,
  chartCodes: Set<string>
): PostingRuleUpdateCheck {
  const empty = { ok: false } as PostingRuleUpdateCheck;
  const ruleKey = String(input.ruleKey || "").trim();
  if (!def || def.key !== ruleKey) return { ...empty, error: "قاعدة ترحيل غير معروفة." };

  const checkSide = (
    raw: unknown,
    field: "debitCode" | "creditCode",
    adjustable: boolean
  ): string | { error: string; value: string } => {
    const code = String(raw ?? "").trim();
    if (!code) return "";
    if (!adjustable) return { error: `لا يمكن تثبيت ${field === "debitCode" ? "المدين" : "الدائن"} لقاعدة «${def.label}» — طرفها سياقي من السند دائمًا.`, value: code };
    if (!chartCodes.has(code)) return { error: `كود الحساب «${code}» غير موجود في دليل الحسابات — اكتب كودًا من الدليل أو اتركه فارغًا.`, value: code };
    return code;
  };

  const debit = checkSide(input.debitCode, "debitCode", def.debitAdjustable);
  if (typeof debit !== "string") return { ...empty, error: debit.error };
  const credit = checkSide(input.creditCode, "creditCode", def.creditAdjustable);
  if (typeof credit !== "string") return { ...empty, error: credit.error };

  const enabled =
    input.enabled === undefined ? true : input.enabled === true || input.enabled === "true" || input.enabled === 1;

  return { ok: true, ruleKey, debitCode: debit, creditCode: credit, enabled };
}
