import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  builtinCreditName,
  builtinDebitName,
  POSTING_RULE_BY_KEY,
  POSTING_RULE_CATALOG,
  resolvePostingSide,
  resolveRuleKeyForVoucher,
  resolveSeedableCode,
  type BuiltinSideContext,
  type RuleChartAccount,
  type SeedChartAccount,
  type VoucherRuleContext,
} from "@/lib/posting-rules-core";
import {
  buildAccountResolver,
  postNamedEntry,
  postJournalEntry,
  resolveNamedSide,
  type JournalLineInput,
} from "@/lib/journal-server";
import { r3 } from "@/lib/contrack-core";
import { routeAllocations } from "@/lib/subsidiary-core";
import { resolveContractSubsidiaryId } from "@/lib/subsidiary-server";

/**
 * تسميات أنواع السندات لوصف القيد — نسخة محلية لكسر دورة الاستيراد
 * (voucher-server يستورد insertVoucherJournal من هنا؛ الأصل معاد تصديره للعرض منها).
 */
const VOUCHER_TYPE_LABELS: Record<string, string> = {
  receipt: "سند قبض",
  payment: "سند صرف",
  transfer: "سند تحويل",
  custody_return: "إرجاع عهدة",
  salary_deduction: "خصم من راتب",
};

/**
 * posting-rules-server.ts — طبقة خادم قواعد ترحيل السندات — Task 106.
 *  • ensurePostingRules: بذر الكتالوج الافتراضي لكل شركة (سجل نظامي لكل صنف)
 *  • loadPostingRules: قراءة قواعد الشركة مع سد المفقود من الكتالوج في الذاكرة
 *    (بلا كتابة على مسار النشر الساخن — البذر الفعلي عند إنشاء الشركة وشاشة الإعدادات)
 *  • insertVoucherJournal: محرك القيد الآلي للسند — يمر بسلسلة الحسم
 *    (صريح → قاعدة الشركة → مدمج سياقي → تسوية) ويكتب الأبعاد الكاملة على السطرين
 */

type Tx = Prisma.TransactionClient;
type DbClient = Prisma.TransactionClient | PrismaClient;

/**
 * بذر قواعد الترحيل الافتراضية لسياق الشركة — يُستدعى عند إنشاء الشركة وفي شاشة الإعدادات وعند الدخول.
 * الكود الأزرق من الكتالوج يُحسم إلى ورقة فعلية تقبل النشر في دليل *هذه الشركة*
 * (resolveSeedableCode: 1140→114001/5300→530001 بعد دمج Task 105) — والبذرة
 * النظامية التي ثبتت كودًا صار غير قابل للنشر تُصلَح آليًا إلى الورقة الحالية.
 */
export async function ensurePostingRules(tx: DbClient): Promise<{ created: number; repaired: number }> {
  const chart = await tx.account.findMany({
    where: { isActive: true },
    select: { code: true, isLeaf: true, allowPosting: true, isActive: true },
  });
  const resolve = (blueprint: string) => resolveSeedableCode(blueprint, chart as SeedChartAccount[]);

  const existing = await tx.postingRule.findMany();
  const byKey = new Map(existing.map((r) => [r.ruleKey, r]));
  let created = 0;
  let repaired = 0;

  const missing = POSTING_RULE_CATALOG.filter((d) => !byKey.has(d.key));
  if (missing.length) {
    await tx.postingRule.createMany({
      data: missing.map((d) => ({
        ruleKey: d.key,
        label: d.label,
        debitCode: resolve(d.defaultDebitCode),
        creditCode: resolve(d.defaultCreditCode),
        enabled: true,
        isSystem: true,
      })),
    });
    created = missing.length;
  }

  // إصلاح البذرة النظامية: كود مثبّت صار غير قابل للنشر ⇒ يُعاد حسمه من الأزرق.
  // المقارنة تامة (الكود نفسه ورقة نشطة تقبل النشر) — لا يكفي أن للكود ذرية قابلة.
  // Task 107: كود فارغ لقاعدة أزرقها المدمج غير فارغ (مثل invoice_issue 1121/4100)
  // يعني بذرة سابقة لنموذج الدليل قبل وجوده — تُحسم الآن أيضًا.
  for (const def of POSTING_RULE_CATALOG) {
    const row = byKey.get(def.key);
    if (!row || !row.isSystem) continue;
    const stillValid = (code: string) => resolveSeedableCode(code, chart as SeedChartAccount[]) === code;
    const patch: { debitCode?: string; creditCode?: string } = {};
    if (row.debitCode && !stillValid(row.debitCode)) patch.debitCode = resolve(def.defaultDebitCode);
    if (row.creditCode && !stillValid(row.creditCode)) patch.creditCode = resolve(def.defaultCreditCode);
    if (!row.debitCode && def.defaultDebitCode) patch.debitCode = resolve(def.defaultDebitCode);
    if (!row.creditCode && def.defaultCreditCode) patch.creditCode = resolve(def.defaultCreditCode);
    if (Object.keys(patch).length > 0) {
      await tx.postingRule.update({ where: { id: row.id }, data: patch });
      repaired++;
    }
  }
  return { created, repaired };
}

/** صف قاعدة كما يعيش في قاعدة البيانات (مع سد المفقود من الكتالوج) */
export interface LoadedPostingRule {
  ruleKey: string;
  label: string;
  debitCode: string;
  creditCode: string;
  enabled: boolean;
  isSystem: boolean;
  /** جاء من الكتالوج لأن صفه لم يُبذر بعد */
  fromCatalog: boolean;
}

/** قواعد الشركة الحالية — المفقود يُسد من الكتالوج في الذاكرة (بلا كتابة) */
export async function loadPostingRules(client: DbClient): Promise<LoadedPostingRule[]> {
  const rows = await client.postingRule.findMany({ orderBy: { id: "asc" } });
  const byKey = new Map(rows.map((r) => [r.ruleKey, r]));
  const out: LoadedPostingRule[] = [];
  for (const def of POSTING_RULE_CATALOG) {
    const row = byKey.get(def.key);
    out.push(
      row
        ? {
            ruleKey: row.ruleKey,
            label: row.label || def.label,
            debitCode: row.debitCode || "",
            creditCode: row.creditCode || "",
            enabled: row.enabled,
            isSystem: row.isSystem,
            fromCatalog: false,
          }
        : {
            ruleKey: def.key,
            label: def.label,
            debitCode: def.defaultDebitCode,
            creditCode: def.defaultCreditCode,
            enabled: true,
            isSystem: true,
            fromCatalog: true,
          }
    );
  }
  return out;
}

/** خريطة المفاتيح الفعّالة للنشر: القاعدة المفعّلة بأكوادها — معطل/مفقود = أصفار */
async function loadActiveRuleCodes(client: DbClient): Promise<Map<string, { debitCode: string; creditCode: string }>> {
  const rows = await client.postingRule.findMany({ where: { enabled: true }, select: { ruleKey: true, debitCode: true, creditCode: true } });
  return new Map(rows.map((r) => [r.ruleKey, { debitCode: r.debitCode || "", creditCode: r.creditCode || "" }]));
}

/** دليل الشركة كمرشّحات حسم — أوراق نشطة فقط (النشر على الإجماليات ممنوع محركًا) */
export async function loadChartCandidates(client: DbClient): Promise<RuleChartAccount[]> {
  const rows = await client.account.findMany({
    where: { isActive: true, allowPosting: true },
    select: { id: true, code: true, name: true, allowPosting: true, isActive: true },
  });
  return rows as RuleChartAccount[];
}

// ==================== محرك قيد السند ====================

/** مدخلات قيد السند — أبعاد كاملة على السطرين (Task 106: عميل/باطن/بنود/مشاريع/مركز/موظف) */
export interface VoucherJournalInvoiceAllocation {
  invoiceId: number;
  invoiceNumber: string;
  amount: number;
}

export interface VoucherJournalInput {
  id: number;
  voucherNumber: string;
  vtype: string;
  vdate: string;
  amount: number;
  account: string;
  method: string;
  contractId: number | null;
  subContractId: number | null;
  accountId?: number | null;
  custodyAccountId?: number | null;
  accountSnapshot: string;
  partyType: string;
  // الأبعاد التحليلية الكاملة (اختيارية — السيرورات تملؤها من صف السند)
  customerId?: number | null;
  boqItemId?: number | null;
  projectId?: number | null;
  employeeId?: number | null;
  costCenter?: string;
  /**
   * Task 107 — تخصيص السداد على فواتير العميل (قبض حصرًا، يأتي من reallocateVoucherInvoiceLinks).
   * يفتح دائنًا إضافيًا على حساب ذمم قاعدة invoice_issue (نفس مدين قيد الإصدار) بمبلغ التخصيص،
   * والفائض يبقى دائنًا على طرف القاعدة كالسابق — دورة الاستحقاق كاملة: إصدار (مدين ذمم)
   * ثم سداد (دائن ذمم) فلا ازدواج إيراد ولا ذمم معلقة.
   */
  invoiceAllocations?: VoucherJournalInvoiceAllocation[];
}

/**
 * القيد الآلي عند إنشاء السند (_insert_voucher_journal) — عبر قواعد الترحيل:
 *  1) مفتاح القاعدة من سياق السند (resolveRuleKeyForVoucher)
 *  2) طرف كل سطر بسلسلة الحسم: صريح → كود القاعدة → الاسم المدمج (الحاسم النصي/التسوية)
 *  3) الأبعاد الكاملة تُكتب على السطرين (العميل/العقد/الباطن/البند/المشروع/المركز/الموظف)
 * أنواع غير معروفة: بلا قيد (كما كان) — ومفتاح غير معروف يسلك المسار المدمج نصيًا.
 */
export async function insertVoucherJournal(
  tx: Tx,
  v: VoucherJournalInput
): Promise<void> {
  const ruleCtx: VoucherRuleContext = {
    vtype: v.vtype,
    partyType: v.partyType,
    hasAccountId: v.accountId != null,
    hasCustodyAccountId: v.custodyAccountId != null,
    hasSubContractId: v.subContractId != null,
    hasContractId: v.contractId != null,
  };
  const ruleKey = resolveRuleKeyForVoucher(ruleCtx);
  if (!ruleKey) return; // نوع غير معروف — بلا قيد (كما كان)

  const [chart, rulesMap] = await Promise.all([loadChartCandidates(tx), loadActiveRuleCodes(tx)]);
  const rule = ruleKey ? rulesMap.get(ruleKey) : undefined;
  const def = POSTING_RULE_BY_KEY.get(ruleKey);

  const sideCtx: BuiltinSideContext = {
    method: v.method,
    account: v.account,
    snapshot: v.accountSnapshot,
    partyType: v.partyType,
    hasContractId: v.contractId != null,
  };

  // ملاحظة التصفية: سند تصفية عهدة (عهدة + مصروف معًا) يُقفل دائنه على حساب العهدة
  // لا على النقد — لا تصرف نقدي جديد في التصفية (وحدة العهد تنشر قيدها مباشرة،
  // وهنا احتياط المسار العام بنفس الدلالة).
  const isCustodySettlement = ruleKey === "custody_settlement";

  const debitRes = resolvePostingSide(
    {
      explicitAccountId: v.accountId ?? null,
      ruleCode: def?.debitAdjustable ? rule?.debitCode || "" : "",
      builtinName: builtinDebitName(v.vtype, sideCtx),
    },
    chart
  );
  const creditRes = resolvePostingSide(
    {
      explicitAccountId: isCustodySettlement
        ? (v.custodyAccountId ?? null)
        : v.vtype === "custody_return"
          ? (v.custodyAccountId ?? null)
          : null,
      ruleCode: def?.creditAdjustable ? rule?.creditCode || "" : "",
      builtinName: isCustodySettlement
        ? (v.accountSnapshot || "العهد")
        : builtinCreditName(v.vtype, sideCtx),
    },
    chart
  );

  const dims = {
    customerId: v.customerId ?? null,
    contractId: v.contractId ?? null,
    subContractId: v.subContractId ?? null,
    boqItemId: v.boqItemId ?? null,
    projectId: v.projectId ?? null,
    employeeId: v.employeeId ?? null,
    costCenter: v.costCenter || "",
  };

  // ===== Task 107 — قبض بسداد فواتير مخصص: قيد متعدد الأسطر =====
  // مدين النقد (كامل المبلغ) + دائن ذمم العملاء لكل فاتورة مسددة + دائن طرف
  // القاعدة للفائض غير المخصص — دورة استحقاق كاملة بلا ازدواج إيراد.
  const allocs = (v.invoiceAllocations || [])
    .map((a) => ({ ...a, amount: r3(a.amount) }))
    .filter((a) => a.amount > 0 && a.invoiceId > 0);
  const allocSum = r3(allocs.reduce((s, a) => s + a.amount, 0));
  const totalAmount = r3(v.amount);
  if (v.vtype === "receipt" && allocs.length > 0 && allocSum > 0 && allocSum <= totalAmount + 0.001) {
    const ruleIss = rulesMap.get("invoice_issue");
    const arRes = resolvePostingSide(
      // حساب الذمم = مدين قاعدة invoice_issue (نفس حساب قيد الإصدار) وإلا الاسم المدمج «العملاء»
      { ruleCode: ruleIss?.debitCode || "", builtinName: "العملاء" },
      chart
    );
    const resolver = await buildAccountResolver(tx);
    const debitId = await resolveNamedSide(
      tx,
      { name: debitRes?.name || builtinDebitName(v.vtype, sideCtx), accountId: debitRes?.accountId ?? null },
      resolver
    );
    const arId = await resolveNamedSide(
      tx,
      { name: arRes?.name || "العملاء", accountId: arRes?.accountId ?? null },
      resolver
    );
    const creditId = await resolveNamedSide(
      tx,
      {
        name: creditRes?.name || (isCustodySettlement ? v.accountSnapshot || "العهد" : builtinCreditName(v.vtype, sideCtx)),
        accountId: creditRes?.accountId ?? null,
      },
      resolver
    );

    // البند الثالث NOVA — دائن كل تخصيص يذهب إلى الفرعي الآلي لعقد فاتورته
    // (1121xxxx) — وإلا حساب الذمم المحسوم أعلاه (docs/subsidiary-wip-design.md §2.2).
    // ضمان رخو: فشل جلب/ضمان الفرعيات يُبقي كل التخصيصات على الحساب الأب كما كان.
    const contractIdByInvoiceId = new Map<number, number | null>();
    const subIdByContractId = new Map<number, number>();
    try {
      const invRows = await tx.invoice.findMany({
        where: { id: { in: allocs.map((a) => a.invoiceId) } },
        select: { id: true, contractId: true },
      });
      for (const inv of invRows) contractIdByInvoiceId.set(inv.id, inv.contractId);
      const contractIds = [...new Set(invRows.map((i) => i.contractId).filter((x): x is number => x != null))];
      for (const cid of contractIds) {
        const subId = await resolveContractSubsidiaryId(tx, cid, "ar");
        if (subId) subIdByContractId.set(cid, subId);
      }
    } catch {
      // بلا فرعيات — التوجيه كله إلى الحساب الأب
    }
    const routedAllocs = routeAllocations(allocs, contractIdByInvoiceId, subIdByContractId, arId);

    const lines: JournalLineInput[] = [
      {
        accountId: debitId,
        debit: totalAmount,
        credit: 0,
        description: debitRes?.name || builtinDebitName(v.vtype, sideCtx),
        ...dims,
      },
      ...routedAllocs.map((r) => ({
        accountId: r.accountId,
        debit: 0,
        credit: r.amount,
        description: r.description,
        ...dims,
      })),
    ];
    const remainder = r3(totalAmount - allocSum);
    if (remainder > 0) {
      lines.push({
        accountId: creditId,
        debit: 0,
        credit: remainder,
        description: creditRes?.name || (isCustodySettlement ? v.accountSnapshot || "العهد" : builtinCreditName(v.vtype, sideCtx)),
        ...dims,
      });
    }
    await postJournalEntry(
      tx,
      {
        entryDate: v.vdate,
        description: `${VOUCHER_TYPE_LABELS[v.vtype] || v.vtype} ${v.voucherNumber}`,
        sourceType: "voucher",
        sourceId: v.id,
        lines,
      },
      "النظام (آلي)"
    );
    return;
  }

  await postNamedEntry(tx, {
    entryDate: v.vdate,
    description: `${VOUCHER_TYPE_LABELS[v.vtype] || v.vtype} ${v.voucherNumber}`,
    debit: { name: debitRes?.name || builtinDebitName(v.vtype, sideCtx), accountId: debitRes?.accountId ?? null },
    credit: {
      name: creditRes?.name || (isCustodySettlement ? v.accountSnapshot || "العهد" : builtinCreditName(v.vtype, sideCtx)),
      accountId: creditRes?.accountId ?? null,
    },
    amount: r3(v.amount),
    dims,
    sourceType: "voucher",
    sourceId: v.id,
  });
}
