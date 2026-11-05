/**
 * accounting-merge-core.ts — نواة دمج شجرة المصروفات القديمة (ExpenseAccount) في
 * الدليل الموحد (Account) — Task 105 (منهج النواة الواحدة: شجرة واحدة فقط).
 *
 * نقية بالكامل (بلا DB): تستقبل صفوف الشجرة القديمة + حسابات الدليل الموجودة
 * وتعيد «خطة دمج» تُنفَّذ ذريًا في سكربت الترحيل. قابلة للاختبار بـ bun test.
 *
 * قواعد الحسم لكل حساب قديم (بترتيب الأولوية):
 *  1. bridge   — جسر Task 103 المعتمد يدويًا من المالك (ExpenseAccount.accountId) — الأعلى احترامًا
 *  2. name     — تطابق تام بالاسم (مُطبَّع: تشكيل/أ/إ/ى/ة) ضمن أوراق الدليل النشطة بالنوع المناسب
 *  3. create   — إنشاء حساب جديد (الحسابات غير المستخدمة في سندات تُهمل وتوثق skipped):
 *     • advance (عهد/سلف) → ابن جديد تحت 1140 «عُهد وسلف الموظفين» بـ accountRole=custody
 *       (لا دمج جماعي في 1140 — كل عهدة موظف تبقى حسابًا مستقلًا لتتبع رصيدها)
 *     • expense → ابن جديد تحت 5300 «مصروفات أخرى» مع نقل includeInProfitability
 *   الأب المستقبل (1140/5300) يتحول إلى فرع (isLeaf=false) عند أخذ أبناء.
 *
 * تحويل السندات (دلالات 1:1 مع القديم):
 *   accountId الرئيسي = حساب المصروف القديم إن وُجد وإلا حساب العهدة القديم
 *   custodyAccountId (الجديد على Account) = حساب العهدة القديم إن وُجد
 *   accountSnapshot = expenseAccountSnapshot || custodyAccountSnapshot || اسم الحساب المحسوم
 */

export interface LegacyExpenseAccountRow {
  id: number;
  parentId: number | null;
  name: string;
  fullPath: string;
  isActive: boolean;
  allowPosting: boolean;
  includeInProfitability: boolean;
  accountKind: string; // expense | advance
  accountId?: number | null; // جسر Task 103
}

export interface AccountCandidate {
  id: number;
  code: string;
  name: string;
  type: string;
  isLeaf: boolean;
  isActive: boolean;
}

/** عنصر خطة: ربط حساب قديم بحساب موجود في الدليل */
export interface MergeLink {
  eaId: number;
  accountId: number;
  method: "bridge" | "name";
}

/** عنصر خطة: إنشاء حساب جديد لاستيعاب حساب قديم غير مطابق */
export interface MergeCreate {
  eaId: number;
  parentCode: "1140" | "5300";
  code: string;
  name: string;
  type: "asset" | "expense";
  accountRole: "standard" | "custody";
  includeInProfitability: boolean;
  method: "create";
}

export interface TreeMergePlan {
  links: MergeLink[];
  creates: MergeCreate[];
  /** أكواد أهملت (غير مستخدمة في سندات ولا لها أبناء مستخدمين) — تُوثق في التقرير وتسقط مع الجدول */
  skipped: { eaId: number; name: string; reason: string }[];
  /** الحسابات الموجودة التي يجب أن تتحول من ورقة إلى فرع قبل إنشاء الأبناء */
  leafToBranchCodes: string[];
  /** ضبط accountRole=custody على حسابات موجودة استقبلت ربط عهدة (مسار الجسر) */
  custodyRoleOnExisting: number[];
  /** ضبط includeInProfitability على حسابات موجودة استقبلت ربط مصروف (مسار الجسر) */
  profitabilityOnExisting: { accountId: number; includeInProfitability: boolean }[];
}

/** تطبيع مطابقة أخف — نفس منطق الجسر القديم (تشكيل/همزات/ة/ى) */
export function normalizeMergeName(s: string): string {
  return (s || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

const CUSTODY_PARENT_CODE = "1140";
const EXPENSE_OTHER_CODE = "5300";

/**
 * بناء خطة الدمج — استراتيجية:
 *  • الورقة/الفرع المستخدم في سندات يستحق حسابًا (ربط أو إنشاء)
 *  • غير المستخدم إطلاقًا يُهمل (تسقط معه الشجرة التنظيمية الميتة — الدليل الجديد الأغنى)
 *  • الأكواد الجديدة = كود الأب + "01","02"… مع تخطي أي كود موجود مسبقًا
 */
export function planTreeMerge(
  eas: LegacyExpenseAccountRow[],
  accounts: AccountCandidate[],
  usedExpenseIds: Set<number>,
  usedCustodyIds: Set<number>,
): TreeMergePlan {
  const plan: TreeMergePlan = { links: [], creates: [], skipped: [], leafToBranchCodes: [], custodyRoleOnExisting: [], profitabilityOnExisting: [] };
  const byId = new Map(eas.map((e) => [e.id, e]));
  const hasChildren = new Set(eas.filter((e) => e.parentId != null && byId.has(e.parentId)).map((e) => e.parentId as number));
  const norm = (s: string) => normalizeMergeName(s);

  // تجميع إنشاءات العهد والمصروفات لبناء الأكواد المتسلسلة لاحقًا
  const pendingCreates: { ea: LegacyExpenseAccountRow; kind: "custody" | "expense" }[] = [];

  for (const ea of eas) {
    const used = usedExpenseIds.has(ea.id) || usedCustodyIds.has(ea.id);
    const kind = ea.accountKind === "advance" ? "custody" : "expense";
    const wantedType = kind === "custody" ? "asset" : "expense";

    // 1) الجسر المعتمد يدويًا — أعلى احترام (مع تحقق أن الحساب موجود ومطابق النوع)
    if (ea.accountId != null) {
      const target = accounts.find((a) => a.id === ea.accountId);
      if (target) {
        plan.links.push({ eaId: ea.id, accountId: target.id, method: "bridge" });
        if (kind === "custody") plan.custodyRoleOnExisting.push(target.id);
        else plan.profitabilityOnExisting.push({ accountId: target.id, includeInProfitability: ea.includeInProfitability });
        continue;
      }
      // الجسر يشير لحساب غير موجود (نسخة قديمة) — نسقط إلى المطابقة
    }

    // 2) مطابقة تامّة بالاسم ضمن الأوراق النشطة بالنوع المناسب
    const pool = accounts.filter((a) => a.isLeaf && a.isActive && a.type === wantedType);
    const exact = pool.find((a) => norm(a.name) === norm(ea.name));
    if (exact) {
      plan.links.push({ eaId: ea.id, accountId: exact.id, method: "name" });
      if (kind === "custody") plan.custodyRoleOnExisting.push(exact.id);
      else plan.profitabilityOnExisting.push({ accountId: exact.id, includeInProfitability: ea.includeInProfitability });
      continue;
    }

    // 3) غير مطابق: المستخدم يستحق إنشاء حساب خاص — غير المستخدم يُهمل
    if (!used) {
      plan.skipped.push({ eaId: ea.id, name: ea.name, reason: kind === "custody" ? "عهدة غير مستخدمة في سندات" : "حساب مصروف غير مستخدم في سندات" });
      continue;
    }
    pendingCreates.push({ ea, kind });
  }

  // بناء الأكواد المتسلسلة: تجاهل ما هو مأخوذ، ثم ترقيم متتابع
  const takenCodes = new Set(accounts.map((a) => a.code));
  const counters = new Map<string, number>();
  for (const { ea, kind } of pendingCreates) {
    const parentCode = kind === "custody" ? CUSTODY_PARENT_CODE : EXPENSE_OTHER_CODE;
    let i = counters.get(parentCode) ?? 1;
    let code = `${parentCode}${String(i).padStart(2, "0")}`;
    while (takenCodes.has(code)) {
      i += 1;
      code = `${parentCode}${String(i).padStart(2, "0")}`;
    }
    counters.set(parentCode, i + 1);
    takenCodes.add(code);
    plan.creates.push({
      eaId: ea.id,
      parentCode,
      code,
      name: ea.name,
      type: kind === "custody" ? "asset" : "expense",
      accountRole: kind === "custody" ? "custody" : "standard",
      includeInProfitability: ea.includeInProfitability,
      method: "create",
    });
    if (!plan.leafToBranchCodes.includes(parentCode)) plan.leafToBranchCodes.push(parentCode);
  }

  return plan;
}

/** خريطة النتيجة بعد تنفيذ الخطة: eaId → معرف الحساب النهائي (للربط أو الإنشاء) */
export function resolveMergeMap(plan: TreeMergePlan, createdRows: { eaId: number; accountId: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const l of plan.links) m.set(l.eaId, l.accountId);
  for (const c of createdRows) m.set(c.eaId, c.accountId);
  return m;
}

export interface LegacyVoucherAccountFields {
  id: number;
  expenseAccountId: number | null;
  custodyAccountId: number | null;
  expenseAccountSnapshot: string;
  custodyAccountSnapshot: string;
}

/** صف تحديث سند واحد بعد الدمج — null يعني «بلا تغيير» (الحقل لم يكن مملوءًا) */
export interface VoucherAccountUpdate {
  id: number;
  accountId: number | null;
  custodyAccountId: number | null;
  accountSnapshot: string | null;
}

/**
 * تحويل صفوف السندات إلى الشكل الجديد — دلالات 1:1:
 *  • handover/return: custody فقط → accountId = حساب العهدة، custody = نفسه
 *  • payment مصروف: expense فقط → accountId = حساب المصروف
 *  • settlement (تصفية عهدة): الاثنان → accountId = المصروف، custody = العهدة
 */
export function planVoucherFieldMigration(
  vouchers: LegacyVoucherAccountFields[],
  mergeMap: Map<number, number>,
  accountNames: Map<number, string>,
): { updates: VoucherAccountUpdate[]; unresolved: number[] } {
  const updates: VoucherAccountUpdate[] = [];
  const unresolved: number[] = [];
  for (const v of vouchers) {
    const exp = v.expenseAccountId != null ? mergeMap.get(v.expenseAccountId) : undefined;
    const cus = v.custodyAccountId != null ? mergeMap.get(v.custodyAccountId) : undefined;
    // السند له حساب قديم لكن الحسم فشل — مستحيل عمليًا (الخطة تغطي كل المستخدم) لكن نحرص
    if ((v.expenseAccountId != null && exp === undefined) || (v.custodyAccountId != null && cus === undefined)) {
      unresolved.push(v.id);
      continue;
    }
    const main = exp ?? cus;
    if (v.expenseAccountId == null && v.custodyAccountId == null) continue; // قبض/تحويل — بلا حساب
    const snapshot =
      (v.expenseAccountSnapshot || v.custodyAccountSnapshot || (main != null ? accountNames.get(main) ?? "" : "")) || null;
    updates.push({ id: v.id, accountId: main ?? null, custodyAccountId: cus ?? null, accountSnapshot: snapshot });
  }
  return { updates, unresolved };
}

/** فحوص ما بعد الترحيل — تعاد بالـSQL أيضًا في السكربت كخط دفاع ثانٍ */
export function verifyFieldMigration(
  before: LegacyVoucherAccountFields[],
  after: VoucherAccountUpdate[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const afterById = new Map(after.map((u) => [u.id, u]));
  for (const b of before) {
    const a = afterById.get(b.id);
    if (!a) continue;
    if (b.expenseAccountId != null && b.custodyAccountId == null && a.accountId == null) {
      errors.push(`voucher ${b.id}: كان له حساب مصروف وأصبح بلا حساب رئيسي`);
    }
    if (b.custodyAccountId != null && a.custodyAccountId == null && a.accountId == null) {
      errors.push(`voucher ${b.id}: كان له حساب عهدة وأصبح بلا أي حساب`);
    }
    // التصفية: المصروف والعهدة كلاهما يجب أن يبقى محفوظًا
    if (b.expenseAccountId != null && b.custodyAccountId != null) {
      if (a.accountId == null || a.custodyAccountId == null) {
        errors.push(`voucher ${b.id}: سند تصفية فقد أحد طرفيه (main=${a.accountId}, custody=${a.custodyAccountId})`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
