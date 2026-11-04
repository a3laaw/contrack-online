/**
 * accounting-core.ts — نواة المحاسبة النقية (بلا React ولا server-only) — Task 102.
 * دليل الحسابات الكويتي القياسي + قواعد التحقق + جسر ربط شجرة المصروفات القديمة
 * + مساعدات خريطة XBRL — كلها دوال نقية قابلة للاختبار بـ bun test مباشرة.
 *
 * قرارات التصميم الموثقة:
 *  • الأكواد هيكلية 1xxx أصول / 2xxx التزامات / 3xxx حقوق ملكية / 4xxx إيرادات / 5xxx مصروفات
 *    (مطابقة لأقسام القوائم في الصيغ الموحدة الكويتية — القرار الوزاري 44/2016).
 *  • طبيعة الرصيد الطبيعية: asset/expense = مدين، liability/equity/revenue = دائن،
 *    مع استثناء الحسابات المخالفة (مجمع الإهلاك: أصل بطبيعة دائنة).
 *  • خريطة XBRL: عناصر ifrs-full الأساسية المعروفة من taxonomy IFRS Core،
 *    والعناصر الخاصة بالكويت (الزكاة/المحتجزات/الباطن...) ببادئة kw: التي
 *    تقابل امتداد الـtaxonomy الكويتي فوق IFRS — الترتيب نفسه المطلوب لتصدير
 *    القوائم الموسومة لبوابة وزارة التجارة لاحقًا.
 *  • الرصيد الافتتاحي مخزَّن موقَّعًا: مدين موجب / دائن سالب — وميزان الأرصدة
 *    الافتتاحية يتحقق أن المجموع صفر (Task 103).
 */

// ==================== الأنواع ====================

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountNature = "debit" | "credit";
export type OpeningDirection = "debit" | "credit";

export const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
export const ACCOUNT_NATURES: readonly AccountNature[] = ["debit", "credit"];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

export const NATURE_LABEL: Record<AccountNature, string> = {
  debit: "مدين",
  credit: "دائن",
};

/** طبيعة الرصيد الطبيعية للنوع — asset/expense مدين والبقية دائن */
export function defaultNatureForType(type: AccountType): AccountNature {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** البادئة الهيكلية المنتظرة لكل نوع (أول خانة من الكود) */
export const TYPE_PREFIX: Record<AccountType, string> = {
  asset: "1",
  liability: "2",
  equity: "3",
  revenue: "4",
  expense: "5",
};

// ==================== تعريف دليل الحسابات الكويتي القياسي ====================

export interface AccountSeedNode {
  code: string;
  name: string;
  type: AccountType;
  /** طبيعة الرصيد — تُشتق من النوع إن لم تُمرَّر (للاستثناءات المخالفة) */
  nature?: AccountNature;
  /** ورقة تستقبل قيودًا — الافتراضي true للعقد النهائية وfalse لما لها أبناء */
  leaf?: boolean;
  allowPosting?: boolean;
  /** خريطة عنصر XBRL (ifrs-full:… أو kw:… للعناصر الكويتية) */
  xbrl?: string;
  notes?: string;
  children?: AccountSeedNode[];
}

/**
 * دليل مقاولات قياسي لكل شركة جديدة — يُبذَّر مرة واحدة (isSystem=true).
 * البنية مطابقة لأقسام قائمة المركز المالي وقائمة الدخل بالصيغة الكويتية.
 */
export const ACCOUNT_SEED: AccountSeedNode[] = [
  {
    code: "1000",
    name: "الأصول",
    type: "asset",
    xbrl: "ifrs-full:Assets",
    children: [
      {
        code: "1100",
        name: "الأصول المتداولة",
        type: "asset",
        xbrl: "ifrs-full:CurrentAssets",
        children: [
          {
            code: "1110",
            name: "النقد وما في حكمه",
            type: "asset",
            xbrl: "ifrs-full:CashAndCashEquivalents",
            children: [
              { code: "1111", name: "الصندوق", type: "asset", xbrl: "kw:CashOnHand", notes: "النقدية اليدوية — تربط بسندات القبض والصرف النقدية" },
              { code: "1112", name: "البنك — الحساب الجاري", type: "asset", xbrl: "ifrs-full:CashAndBankBalances", notes: "الحسابات البنكية — تربط بالبوابة البنكية والتحويلات" },
            ],
          },
          {
            code: "1120",
            name: "العملاء وذمم مدينة",
            type: "asset",
            xbrl: "ifrs-full:TradeAndOtherCurrentReceivables",
            children: [
              { code: "1121", name: "العملاء", type: "asset", xbrl: "ifrs-full:TradeAccountsReceivableCurrent", notes: "أرصدة العملاء المستحقة على العقود" },
              { code: "1122", name: "محتجزات العملاء", type: "asset", xbrl: "kw:CustomerRetentionsReceivable", notes: "المحتجزات البنكية/التعاقدية على المستخلصات" },
            ],
          },
          { code: "1130", name: "أوراق القبض", type: "asset", xbrl: "kw:NotesReceivableCurrent" },
          { code: "1140", name: "عُهد وسلف الموظفين", type: "asset", xbrl: "kw:EmployeeAdvancesReceivable", notes: "مقابل شجرة العُهد والسلف القديمة" },
          { code: "1150", name: "دفعات مقدمة للموردين", type: "asset", xbrl: "kw:AdvancesToSuppliers" },
        ],
      },
      {
        code: "1200",
        name: "الأصول غير المتداولة",
        type: "asset",
        xbrl: "ifrs-full:NonCurrentAssets",
        children: [
          {
            code: "1210",
            name: "الأصول الثابتة",
            type: "asset",
            xbrl: "ifrs-full:PropertyPlantAndEquipment",
            children: [
              { code: "1211", name: "أثاث وأجهزة مكتبية", type: "asset", xbrl: "ifrs-full:PropertyPlantAndEquipment" },
              { code: "1212", name: "سيارات وآليات", type: "asset", xbrl: "ifrs-full:PropertyPlantAndEquipment" },
              { code: "1213", name: "معدات تنفيذ وأعمال", type: "asset", xbrl: "ifrs-full:PropertyPlantAndEquipment" },
            ],
          },
          {
            code: "1220",
            name: "مجمع إهلاك الأصول الثابتة",
            type: "asset",
            nature: "credit", // استثناء مخالف: حساب مجمع داخل الأصول بطبيعة دائنة
            xbrl: "ifrs-full:AccumulatedDepreciationPropertyPlantAndEquipment",
          },
        ],
      },
    ],
  },
  {
    code: "2000",
    name: "الالتزامات",
    type: "liability",
    xbrl: "ifrs-full:Liabilities",
    children: [
      {
        code: "2100",
        name: "الالتزامات المتداولة",
        type: "liability",
        xbrl: "ifrs-full:CurrentLiabilities",
        children: [
          {
            code: "2110",
            name: "الموردون والدائنون",
            type: "liability",
            xbrl: "ifrs-full:TradeAndOtherCurrentPayables",
            children: [
              { code: "2111", name: "الموردون", type: "liability", xbrl: "ifrs-full:TradeAccountsPayableCurrent" },
            ],
          },
          {
            code: "2120",
            name: "مقاولو الباطن",
            type: "liability",
            xbrl: "ifrs-full:TradeAndOtherCurrentPayables",
            children: [
              { code: "2121", name: "مستحقات مقاولي الباطن", type: "liability", xbrl: "kw:SubcontractorsPayables" },
              { code: "2122", name: "محتجزات مقاولي الباطن", type: "liability", xbrl: "kw:SubcontractorRetentionsPayable" },
            ],
          },
          { code: "2130", name: "أوراق الدفع", type: "liability", xbrl: "kw:NotesPayableCurrent" },
          { code: "2140", name: "دفعات مقدمة من العملاء", type: "liability", xbrl: "ifrs-full:ContractLiabilitiesCurrent" },
          { code: "2150", name: "مصاريف مستحقة", type: "liability", xbrl: "ifrs-full:AccruedExpensesCurrent" },
          { code: "2160", name: "رواتب مستحقة", type: "liability", xbrl: "kw:SalariesPayable" },
          { code: "2170", name: "زكاة مستحقة", type: "liability", xbrl: "kw:ZakatPayable", notes: "زكاة صندوق الكويت الوطني 1% — قانون 8/2019" },
        ],
      },
      {
        code: "2200",
        name: "الالتزامات غير المتداولة",
        type: "liability",
        xbrl: "ifrs-full:NonCurrentLiabilities",
        children: [
          { code: "2210", name: "قروض طويلة الأجل", type: "liability", xbrl: "kw:LongTermLoans" },
        ],
      },
    ],
  },
  {
    code: "3000",
    name: "حقوق الملكية",
    type: "equity",
    xbrl: "ifrs-full:Equity",
    children: [
      { code: "3100", name: "رأس المال", type: "equity", xbrl: "ifrs-full:IssuedCapital" },
      { code: "3200", name: "الاحتياطيات", type: "equity", xbrl: "kw:Reserves" },
      { code: "3300", name: "الأرباح المحتجزة", type: "equity", xbrl: "ifrs-full:RetainedEarnings" },
      { code: "3400", name: "جاري الشركاء", type: "equity", xbrl: "kw:PartnersCurrentAccounts" },
    ],
  },
  {
    code: "4000",
    name: "الإيرادات",
    type: "revenue",
    xbrl: "ifrs-full:Revenue",
    children: [
      { code: "4100", name: "إيرادات العقود", type: "revenue", xbrl: "ifrs-full:RevenueFromContractsWithCustomers", notes: "المقبوضات/المستخلصات على عقود التنفيذ" },
      { code: "4200", name: "إيرادات أوامر التغيير", type: "revenue", xbrl: "kw:RevenueFromVariationOrders" },
      { code: "4300", name: "إيرادات أخرى", type: "revenue", xbrl: "ifrs-full:OtherIncome" },
    ],
  },
  {
    code: "5000",
    name: "المصروفات",
    type: "expense",
    xbrl: "ifrs-full:Expenses",
    children: [
      {
        code: "5100",
        name: "تكلفة الأعمال المباشرة",
        type: "expense",
        xbrl: "ifrs-full:CostOfSales",
        children: [
          { code: "5110", name: "مواد وأدوات", type: "expense", xbrl: "kw:DirectMaterialsCost" },
          { code: "5120", name: "عمالة ومقاولو باطن", type: "expense", xbrl: "kw:DirectLabourAndSubcontractCost" },
          { code: "5130", name: "تشغيل معدات", type: "expense", xbrl: "kw:EquipmentOperatingCost" },
        ],
      },
      {
        code: "5200",
        name: "مصروفات إدارية وعمومية",
        type: "expense",
        xbrl: "ifrs-full:GeneralAndAdministrativeExpense",
        children: [
          { code: "5210", name: "رواتب وأجور", type: "expense", xbrl: "kw:SalariesAndWagesExpense" },
          { code: "5220", name: "إيجارات", type: "expense", xbrl: "kw:RentExpense" },
          { code: "5230", name: "كهرباء وماء واتصالات", type: "expense", xbrl: "kw:UtilitiesAndTelecomExpense" },
          { code: "5240", name: "صيانة ووقود", type: "expense", xbrl: "kw:MaintenanceAndFuelExpense" },
          { code: "5250", name: "قرطاسية ومطبوعات", type: "expense", xbrl: "kw:StationeryAndPrintingExpense" },
          { code: "5260", name: "رسوم وعمولات بنكية", type: "expense", xbrl: "kw:BankFeesAndCommissionsExpense" },
        ],
      },
      { code: "5300", name: "مصروفات أخرى", type: "expense", xbrl: "kw:OtherExpenses" },
      { code: "5400", name: "مصروف الزكاة", type: "expense", xbrl: "kw:ZakatExpense", notes: "يُقفل عليه احتساب الزكاة السنوية 1%" },
    ],
  },
];

/** عدد أوراق الدليل المُبذَّر (للعرض والاختبار) */
export function countSeedLeaves(nodes: AccountSeedNode[] = ACCOUNT_SEED): number {
  let n = 0;
  for (const node of nodes) {
    if (!node.children?.length) n += 1;
    else n += countSeedLeaves(node.children);
  }
  return n;
}

// ==================== قواعد التحقق (تعديلات الدليل) ====================

export interface AccountMutationInput {
  code?: unknown;
  name?: unknown;
  type?: unknown;
  nature?: unknown;
  parentType?: AccountType | null;
  isSystem?: boolean;
}

export interface MutationCheck {
  ok: boolean;
  error?: string;
  code?: string;
  name?: string;
  type?: AccountType;
  nature?: AccountNature;
}

/** كود الحساب: أرقام فقط من 3 إلى 8 خانات */
export function isValidAccountCode(code: string): boolean {
  return /^\d{3,8}$/.test(code);
}

/**
 * تحقق موحّد لإنشاء/تعديل حساب — قواعد الشجرة:
 *  • الكود أرقام 3–8 خانات ويوافق بادئة النوع (1xxx أصول...)
 *  • الابن يرث نوع الأب حصرًا (لا أصل تحت التزامات)
 *  • الطبيعة تُشتق من النوع ما لم تُمرَّر صراحةً (الاستثناءات المخالفة)
 *  • الحساب النظامي لا يتغير كوده ولا نوعه ولا طبيعته
 */
export function checkAccountMutation(input: AccountMutationInput, existing?: {
  code: string;
  type: AccountType;
  nature: AccountNature;
  isSystem: boolean;
}): MutationCheck {
  const isCreate = !existing;
  const code = String(input.code ?? (existing?.code ?? "")).trim();
  const name = String(input.name ?? "").trim();
  const type = (input.type !== undefined ? String(input.type) : existing?.type) as AccountType | undefined;

  if (!name) return { ok: false, error: "اسم الحساب مطلوب." };
  if (name.length > 120) return { ok: false, error: "اسم الحساب طويل جدًا." };

  if (type === undefined || !ACCOUNT_TYPES.includes(type)) {
    return { ok: false, error: "نوع الحساب غير صحيح — اختر من القائمة." };
  }

  // الحساب النظامي: الكود والنوع والطبيعة مقفولة (تعديل الاسم/البيانات فقط)
  if (existing?.isSystem) {
    if (isCreate) return { ok: false, error: "غير متاح." };
    if (input.code !== undefined && code !== existing.code) {
      return { ok: false, error: "لا يمكن تغيير كود حساب نظامي مُبذَّر." };
    }
    if (input.type !== undefined && type !== existing.type) {
      return { ok: false, error: "لا يمكن تغيير نوع حساب نظامي مُبذَّر." };
    }
  }

  if (!isValidAccountCode(code)) {
    return { ok: false, error: "كود الحساب يجب أن يكون أرقامًا من 3 إلى 8 خانات." };
  }
  if (!code.startsWith(TYPE_PREFIX[type])) {
    return { ok: false, error: `كود حساب ${ACCOUNT_TYPE_LABEL[type]} يجب أن يبدأ بـ ${TYPE_PREFIX[type]}.` };
  }

  // توافق نوع الابن مع الأب
  if (input.parentType != null && input.parentType !== type) {
    return {
      ok: false,
      error: `لا يمكن إنشاء حساب ${ACCOUNT_TYPE_LABEL[type]} تحت حساب ${ACCOUNT_TYPE_LABEL[input.parentType]} — الابن يرث نوع الأب.`,
    };
  }

  let nature = (input.nature !== undefined ? String(input.nature) : existing?.nature) as AccountNature | undefined;
  if (nature === undefined) nature = defaultNatureForType(type);
  if (!ACCOUNT_NATURES.includes(nature)) {
    return { ok: false, error: "طبيعة الرصيد غير صحيحة — مدين أو دائن فقط." };
  }

  return { ok: true, code, name, type, nature };
}

// ==================== جسر ربط شجرة المصروفات القديمة ====================

export interface BridgeAccountCandidate {
  id: number;
  code: string;
  name: string;
  type: string;
  isLeaf: boolean;
  isActive: boolean;
}

export interface BridgeSuggestionResult {
  expenseAccountId: number;
  suggestedId: number | null;
  suggestedName: string | null;
}

/**
 * اقتراح الحساب المحاسبي الموافق لحساب مصروف قديم — مطابقة الاسم/المسار
 * بأعرَف المطابقة أولًا ثم تضمين المسار. تفاضل بين أنواع شجرة المصروفات:
 * expense → حسابات مصروفات، advance → حسابات أصول (عُهد وسلف).
 */
export function suggestAccountForExpenseAccount(
  name: string,
  fullPath: string,
  accountKind: string,
  accounts: BridgeAccountCandidate[]
): number | null {
  const normName = normalizeMatch(name);
  const pathSegs = String(fullPath || name)
    .split("/")
    .map((s) => normalizeMatch(s))
    .filter(Boolean);
  const wantedType = accountKind === "advance" ? "asset" : "expense";

  const pool = accounts.filter(
    (a) => a.isLeaf && a.isActive && a.type === wantedType
  );

  // 1) تطابق تام للاسم
  const exact = pool.find((a) => normalizeMatch(a.name) === normName);
  if (exact) return exact.id;

  // 2) تطابق تام مع أي مقطع من المسار (الأعمق أولًا)
  for (let i = pathSegs.length - 1; i >= 0; i -= 1) {
    const seg = pathSegs[i];
    if (!seg) continue;
    const bySeg = pool.find((a) => normalizeMatch(a.name) === seg);
    if (bySeg) return bySeg.id;
  }

  // 3) تضمين (الاسم القديم داخل اسم الدليل أو العكس)
  const partial = pool.find(
    (a) => {
      const an = normalizeMatch(a.name);
      return normName.length >= 3 && (an.includes(normName) || normName.includes(an));
    }
  );
  if (partial) return partial.id;

  return null;
}

/** تطبيع مطابقة أخف من normalizeArabic الرسمي — يكفي للربط الآلي */
function normalizeMatch(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

/** رفع مقترحات لكل شجرة المصروفات دفعة واحدة */
export function suggestBridgeLinks(
  expenseAccounts: { id: number; name: string; fullPath: string; accountKind: string }[],
  accounts: BridgeAccountCandidate[]
): BridgeSuggestionResult[] {
  return expenseAccounts.map((ea) => {
    const suggestedId = suggestAccountForExpenseAccount(ea.name, ea.fullPath, ea.accountKind, accounts);
    const suggested = suggestedId != null ? accounts.find((a) => a.id === suggestedId) : null;
    return {
      expenseAccountId: ea.id,
      suggestedId,
      suggestedName: suggested ? `${suggested.code} — ${suggested.name}` : null,
    };
  });
}

// ==================== الأرصدة الافتتاحية (Task 103) ====================

/** القيمة الموقَّعة للرصيد الافتتاحي: مدين موجب / دائن سالب */
export function openingBalanceSigned(direction: OpeningDirection, amount: number): number {
  const v = Math.abs(Number(amount) || 0);
  return direction === "credit" ? -v : v;
}

export interface OpeningBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  openingBalance: number; // موقَّع
}

export interface OpeningBalanceCheck {
  totalDebit: number;
  totalCredit: number;
  diff: number;
  balanced: boolean; // |diff| < 0.001
}

/** ميزان الأرصدة الافتتاحية: مجموع المدين مقابل مجموع الدائن والفرق */
export function checkOpeningBalance(rows: OpeningBalanceRow[]): OpeningBalanceCheck {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of rows) {
    if (r.openingBalance >= 0) totalDebit += r.openingBalance;
    else totalCredit += -r.openingBalance;
  }
  const diff = Math.round((totalDebit - totalCredit) * 1000) / 1000;
  return { totalDebit, totalCredit, diff, balanced: Math.abs(diff) < 0.001 };
}

// ==================== مساعدات XBRL ====================

/** التحقق من شكل عنصر XBRL: namespace:Element (حروف إنجليزية وأرقام وشرطات سفلية) */
export function isValidXbrlElement(v: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/.test(v);
}

export interface XbrlMappedAccount {
  code: string;
  name: string;
  type: AccountType;
  xbrlElement: string;
}

/** عدّ خريطة XBRL: الموصولة من الأوراق + قائمة العناصر الفريدة (للإحصاء في الشاشة) */
export function xbrlMappingStats(accounts: XbrlMappedAccount[]): {
  leavesTotal: number;
  leavesMapped: number;
  unmappedCodes: string[];
  uniqueElements: string[];
} {
  const leaves = accounts;
  const mapped = leaves.filter((a) => a.xbrlElement && isValidXbrlElement(a.xbrlElement));
  const unique = Array.from(new Set(mapped.map((a) => a.xbrlElement)));
  return {
    leavesTotal: leaves.length,
    leavesMapped: mapped.length,
    unmappedCodes: leaves.filter((a) => !a.xbrlElement).map((a) => a.code),
    uniqueElements: unique,
  };
}
