import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { r3 } from "@/lib/accounting-journal";
import {
  buildGlRows,
  fifoAging,
  tbTotals,
  tbByType,
  tbDebitCredit,
  AGING_BUCKET_LABELS,
  type AgingKind,
  type GlMovement,
  type GlRow,
  type TbAccountRow,
} from "@/lib/accounting-reports-core";

/**
 * accounting-reports-server.ts — بناة مخرجات المحاسبة من الأستاذ — Task 108.
 * كل الأرقام من JournalLine بالقيود posted حصرًا (الأستاذ مصدر الحقيقة الوحيد)،
 * والتجميع الثقيل بالـSQL (groupBy/aggregate) داخل سياق الشركة (غلاف db).
 *  • دفتر أستاذ: حركات حساب مع رصيد جارٍ + فلاتر الأبعاد (فترة/عميل/عقد/باطن/مركز)
 *  • ميزان مراجعة حتى تاريخ: تجميع accountId بالـSQL + ملخصات النوع ومركز التكلفة
 *  • أعمار الذمم: FIFO على الجانب التحليلي لسطور القيد (customerId / subContractId)
 */

type DimWhere = {
  customerId?: number;
  contractId?: number;
  subContractId?: number;
  costCenter?: string;
};

function dimWhereOf(opts: { customerId?: number; contractId?: number; subContractId?: number; costCenter?: string }): DimWhere {
  const w: DimWhere = {};
  if (opts.customerId) w.customerId = opts.customerId;
  if (opts.contractId) w.contractId = opts.contractId;
  if (opts.subContractId) w.subContractId = opts.subContractId;
  if (opts.costCenter) w.costCenter = opts.costCenter;
  return w;
}

// ==================== دفتر الأستاذ ====================

export interface GeneralLedgerResult {
  account: { id: number; code: string; name: string; nature: string; type: string };
  opening: number; // موقَّع — افتتاحي الحساب + حركة ما قبل بداية الفترة (بنفس فلاتر الأبعاد)
  rows: GlRow[];
  totals: { debit: number; credit: number };
  closing: number; // موقَّع
  closingSide: "debit" | "credit";
}

/** اسم بُعد الباطن: «اسم المقاول · رقم العقد الأم» */
async function subcontractLabels(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = Array.from(new Set(ids.filter((i) => i > 0)));
  if (!unique.length) return map;
  const rows = await db.subContract.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      description: true,
      subcontractor: { select: { name: true } },
      contract: { select: { contractNumber: true } },
    },
  });
  for (const r of rows) {
    const parts = [r.subcontractor?.name || "", r.description || ""].filter(Boolean);
    const label = `${parts.join(" — ")}${r.contract?.contractNumber ? ` · عقد ${r.contract.contractNumber}` : ""}`;
    map.set(r.id, label.trim() || `باطن #${r.id}`);
  }
  return map;
}

export async function buildGeneralLedger(opts: {
  accountId: number;
  from: string;
  to: string;
  customerId?: number;
  contractId?: number;
  subContractId?: number;
  costCenter?: string;
}): Promise<GeneralLedgerResult | null> {
  const account = await db.account.findFirst({
    where: { id: opts.accountId },
    select: { id: true, code: true, name: true, nature: true, type: true, openingBalance: true },
  });
  if (!account) return null;

  const dims = dimWhereOf(opts);
  const entryStatus = { status: "posted" } as const;

  // الافتتاحي: رصيد الحساب الموقَّع + حركة القيود المنشورة قبل بداية الفترة (بنفس الأبعاد)
  let opening = r3(Number(account.openingBalance));
  if (opts.from) {
    const before = await db.journalLine.aggregate({
      where: {
        accountId: account.id,
        ...dims,
        entry: { ...entryStatus, entryDate: { lt: opts.from } },
      },
      _sum: { debit: true, credit: true },
    });
    opening = r3(opening + Number(before._sum.debit ?? 0) - Number(before._sum.credit ?? 0));
  }

  // حركات الفترة — posted حصرًا، ترتيب زمني ثم رقم القيد
  const lines = await db.journalLine.findMany({
    where: {
      accountId: account.id,
      ...dims,
      entry: {
        ...entryStatus,
        ...(opts.from || opts.to
          ? { entryDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
    },
    orderBy: [{ entry: { entryDate: "asc" } }, { entry: { entryNo: "asc" } }, { id: "asc" }],
    include: { entry: { select: { entryNo: true, entryDate: true, description: true, sourceType: true } } },
    take: 5000, // حماية عرض — الأستاذ النشط لفترة محدودة لا يتجاوزها عمليًا
  });

  // حسم أسماء الأبعاد الظاهرة (دفعة واحدة لكل جدول)
  const customerIds = lines.map((l) => l.customerId).filter((v): v is number => v != null && v > 0);
  const contractIds = lines.map((l) => l.contractId).filter((v): v is number => v != null && v > 0);
  const subIds = lines.map((l) => l.subContractId).filter((v): v is number => v != null && v > 0);
  const [customers, contracts, subLabels] = await Promise.all([
    customerIds.length
      ? db.customer.findMany({ where: { id: { in: Array.from(new Set(customerIds)) } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: number; name: string }[]),
    contractIds.length
      ? db.contract.findMany({ where: { id: { in: Array.from(new Set(contractIds)) } }, select: { id: true, contractNumber: true } })
      : Promise.resolve([] as { id: number; contractNumber: string }[]),
    subcontractLabels(subIds),
  ]);
  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const contractNo = new Map(contracts.map((c) => [c.id, c.contractNumber]));

  const movements: GlMovement[] = lines.map((l) => ({
    entryNo: l.entry.entryNo,
    entryDate: l.entry.entryDate,
    description: l.entry.description,
    lineDescription: l.description,
    debit: Number(l.debit),
    credit: Number(l.credit),
    sourceType: l.entry.sourceType,
    customerName: l.customerId ? custName.get(l.customerId) : undefined,
    contractNumber: l.contractId ? contractNo.get(l.contractId) : undefined,
    subcontractLabel: l.subContractId ? subLabels.get(l.subContractId) : undefined,
    costCenter: l.costCenter || undefined,
  }));

  const rows = buildGlRows(opening, movements);
  const totals = {
    debit: r3(rows.reduce((s, x) => s + x.debit, 0)),
    credit: r3(rows.reduce((s, x) => s + x.credit, 0)),
  };
  const closing = r3(opening + totals.debit - totals.credit);
  return {
    account: { id: account.id, code: account.code, name: account.name, nature: account.nature, type: account.type },
    opening,
    rows,
    totals,
    closing,
    closingSide: closing >= 0 ? "debit" : "credit",
  };
}

// ==================== ميزان المراجعة ====================

export interface TrialBalanceResult {
  asOf: string;
  rows: TbAccountRow[];
  totals: ReturnType<typeof tbTotals>;
  byType: { type: string; label: string; net: number; count: number }[];
  byCost: { costCenter: string; debit: number; credit: number; net: number }[];
}

const TYPE_LABEL_AR: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

/**
 * ميزان مراجعة حتى تاريخ — التجميع بالـSQL حصرًا (groupBy على journal_line):
 * الصافي = الافتتاحي الموقَّع + حركة القيود المنشورة حتى asOf.
 * يشمل الحسابات ذات رصيد افتتاحي أو حركة، والأرصدة تُعرض بطرفيها لا بإشارات.
 */
export async function buildTrialBalance(opts: { asOf: string }): Promise<TrialBalanceResult> {
  const asOf = opts.asOf;

  const [accounts, agg, costAgg] = await Promise.all([
    db.account.findMany({
      select: { id: true, code: true, name: true, type: true, openingBalance: true },
      orderBy: { code: "asc" },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { entry: { status: "posted", entryDate: { lte: asOf } } },
      _sum: { debit: true, credit: true },
    }),
    db.journalLine.groupBy({
      by: ["costCenter"],
      where: { entry: { status: "posted", entryDate: { lte: asOf } }, costCenter: { not: "" } },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const aggByAccount = new Map(agg.map((a) => [a.accountId, a._sum]));

  const rows: TbAccountRow[] = [];
  for (const acc of accounts) {
    const sum = aggByAccount.get(acc.id);
    const movementDr = r3(Number(sum?.debit ?? 0));
    const movementCr = r3(Number(sum?.credit ?? 0));
    const opening = r3(Number(acc.openingBalance));
    if (movementDr === 0 && movementCr === 0 && opening === 0) continue; // لا افتتاحي ولا حركة
    rows.push({
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      net: r3(opening + movementDr - movementCr),
      opening,
      movementDr,
      movementCr,
    });
  }

  const totals = tbTotals(rows);

  const byType = tbByType(rows).map((t) => ({
    type: t.type,
    label: TYPE_LABEL_AR[t.type] || t.type,
    net: t.net,
    count: t.count,
  }));

  const byCost = costAgg
    .map((c) => {
      const dr = r3(Number(c._sum.debit ?? 0));
      const cr = r3(Number(c._sum.credit ?? 0));
      return { costCenter: c.costCenter || "—", debit: dr, credit: cr, net: r3(dr - cr) };
    })
    .sort((a, b) => a.costCenter.localeCompare(b.costCenter));

  return { asOf, rows, totals, byType, byCost };
}

// ==================== أعمار الذمم ====================

export interface AgingRow {
  id: number;
  name: string;
  code: string;
  balance: number; // القيمة المطلقة القائمة
  direction: "debit" | "credit" | null;
  buckets: [number, number, number, number];
  oldestDays: number | null;
  lastActivity: string;
}

export interface AgingResultDto {
  kind: AgingKind;
  asOf: string;
  /** أقسام الحسابات المستخدمة (توثيق الشفافية) */
  accountCodes: string[];
  rows: AgingRow[];
  totals: { balance: number; buckets: [number, number, number, number]; count: number };
  note: string;
}

/**
 * أعمار الذمم من الجانب التحليلي لسطور القيد:
 *  • العملاء → أوراق القيود على حسابات قسم «العملاء وذمم مدينة» (112x) ببُعد customerId
 *  • الباطن → حسابات قسم «مقاولو الباطن» (212x) ببُعد subContractId
 * التسوية FIFO (الأقدم أولًا) والشيخوخة من تاريخ البند المفتوح المتبقي.
 * الافتتاحي المجمّع على الحساب بلا بُعد الطرف لا يُشيَّخ (لا تاريخ له) — موثق في الملاحظة.
 */
export async function buildAging(opts: { kind: AgingKind; asOf: string }): Promise<AgingResultDto> {
  const { kind, asOf } = opts;
  const isCustomers = kind === "customers";

  const accounts = await db.account.findMany({
    where: {
      type: isCustomers ? "asset" : "liability",
      code: { startsWith: isCustomers ? "112" : "212" },
    },
    select: { id: true, code: true, name: true },
  });
  const accountIds = accounts.map((a) => a.id);

  // أسطر الذمم ببُعد الطرف — تفريع صريح (لا مفاتيح محسوبة) لأمان أنواع Prisma
  type DimLine = { dimId: number | null; debit: Prisma.Decimal; credit: Prisma.Decimal; entryDate: string };
  let lines: DimLine[] = [];
  if (accountIds.length) {
    if (isCustomers) {
      const rows = await db.journalLine.findMany({
        where: {
          accountId: { in: accountIds },
          customerId: { not: null },
          entry: { status: "posted", entryDate: { lte: asOf } },
        },
        select: { customerId: true, debit: true, credit: true, entry: { select: { entryDate: true } } },
        orderBy: { id: "asc" },
      });
      lines = rows.map((r) => ({ dimId: r.customerId, debit: r.debit, credit: r.credit, entryDate: r.entry.entryDate }));
    } else {
      const rows = await db.journalLine.findMany({
        where: {
          accountId: { in: accountIds },
          subContractId: { not: null },
          entry: { status: "posted", entryDate: { lte: asOf } },
        },
        select: { subContractId: true, debit: true, credit: true, entry: { select: { entryDate: true } } },
        orderBy: { id: "asc" },
      });
      lines = rows.map((r) => ({ dimId: r.subContractId, debit: r.debit, credit: r.credit, entryDate: r.entry.entryDate }));
    }
  }

  // تجميع أسطر كل طرف ثم FIFO
  type Group = { lines: { date: string; debit: number; credit: number }[] };
  const groups = new Map<number, Group>();
  for (const l of lines) {
    if (l.dimId == null) continue;
    const g = groups.get(l.dimId) || { lines: [] };
    g.lines.push({ date: l.entryDate, debit: Number(l.debit), credit: Number(l.credit) });
    groups.set(l.dimId, g);
  }

  // حسم الأسماء والأكواد دفعة واحدة
  const dimIds = Array.from(groups.keys());
  const nameMap = new Map<number, { name: string; code: string }>();
  if (isCustomers && dimIds.length) {
    const rows = await db.customer.findMany({
      where: { id: { in: dimIds } },
      select: { id: true, name: true, customerCode: true },
    });
    for (const c of rows) nameMap.set(c.id, { name: c.name, code: c.customerCode });
  } else if (!isCustomers && dimIds.length) {
    const rows = await db.subContract.findMany({
      where: { id: { in: dimIds } },
      select: {
        id: true,
        description: true,
        subcontractor: { select: { name: true, subCode: true } },
        contract: { select: { contractNumber: true } },
      },
    });
    for (const s of rows) {
      nameMap.set(s.id, {
        name: `${s.subcontractor?.name || "مقاول"}${s.description ? ` — ${s.description}` : ""}${
          s.contract?.contractNumber ? ` · عقد ${s.contract.contractNumber}` : ""
        }`,
        code: s.subcontractor?.subCode || `SC-${s.id}`,
      });
    }
  }

  const rows: AgingRow[] = [];
  for (const [dimId, g] of groups) {
    const res = fifoAging(g.lines, asOf, isCustomers ? "debit" : "credit");
    if (res.balance <= 0.0005 && res.direction == null) continue; // مسوّى كليًا
    const meta = nameMap.get(dimId);
    rows.push({
      id: dimId,
      name: meta?.name || (isCustomers ? `عميل #${dimId}` : `باطن #${dimId}`),
      code: meta?.code || "",
      balance: res.balance,
      direction: res.direction,
      buckets: res.buckets,
      oldestDays: res.oldestDays,
      lastActivity: res.lastActivity,
    });
  }

  rows.sort((a, b) => r3(b.balance) - r3(a.balance));
  const totals = {
    balance: r3(rows.filter((r) => r.direction === (isCustomers ? "debit" : "credit")).reduce((s, r) => s + r.balance, 0)),
    buckets: [0, 1, 2, 3].map((i) =>
      r3(rows.reduce((s, r) => s + Math.max(0, r.buckets[i] as number), 0))
    ) as [number, number, number, number],
    count: rows.length,
  };

  return {
    kind,
    asOf,
    accountCodes: accounts.map((a) => a.code),
    rows,
    totals,
    note: `التسوية FIFO على حسابات الذمم (${accounts.map((a) => a.code).join("، ") || "لا حسابات مطابقة"}) — الأعمار من تاريخ البنود المفتوحة ببُعد ${
      isCustomers ? "العميل" : "عقد الباطن"
    }؛ الافتتاحي المجمّع على الحساب بلا بُعد لا يدخل الشيخوخة. الأعمدة: ${AGING_BUCKET_LABELS.join(" · ")}.`,
  };
}
