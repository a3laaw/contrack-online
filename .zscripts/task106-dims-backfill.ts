import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

/**
 * Task 106 — سد الأبعاد التحليلية على أسطر قيود السندات التاريخية (دفعة SQL واحدة).
 * القواعد:
 *  • لا يُلمس أي مبلغ (debit/credit) — الأرصدة ثابتة، الفحص قبل/بعد يؤكد.
 *  • يُملأ الحقل الفارغ فقط — لا استبدال لقيم موجودة.
 *  • customerId = expenseCustomerId ?? (partyType=customer→partyId) ?? contract.customerId.
 * التقرير: db/task106-dims-backfill-report.json
 */

const db = new PrismaClient();
const ser = (_k: string, v: unknown) => (typeof v === "bigint" ? String(v) : v);

async function companyBalances(): Promise<Map<number, { dr: number; cr: number }>> {
  const rows = await db.journalLine.groupBy({
    by: ["companyId"],
    _sum: { debit: true, credit: true },
    where: { entry: { status: "posted" } },
  });
  const map = new Map<number, { dr: number; cr: number }>();
  for (const r of rows) {
    map.set(r.companyId, { dr: Number(r._sum.debit || 0), cr: Number(r._sum.credit || 0) });
  }
  return map;
}

const fmt = (m: Map<number, { dr: number; cr: number }>) => {
  const out: Record<string, { dr: number; cr: number; diff: number }> = {};
  for (const [co, b] of m) out[String(co)] = { dr: b.dr, cr: b.cr, diff: Math.round((b.dr - b.cr) * 1000) / 1000 };
  return out;
};

async function main() {
  const before = await companyBalances();

  const vouchers = await db.voucher.findMany({
    select: {
      id: true,
      partyType: true,
      partyId: true,
      expenseCustomerId: true,
      contractId: true,
      contract: { select: { customerId: true } },
      subContractId: true,
      boqItemId: true,
      projectId: true,
      costCenter: true,
      advanceEmployeeId: true,
    },
  });
  const vById = new Map(vouchers.map((v) => [v.id, v]));

  const entries = await db.journalEntry.findMany({
    where: { sourceType: { in: ["voucher", "voucher_receipt", "voucher_payment", "voucher_transfer"] } },
    select: { id: true, sourceId: true },
  });

  const report: Record<string, unknown> = {
    task: "task106-dims-backfill",
    stamp: new Date().toISOString(),
    entriesConsidered: entries.length,
    entriesMatched: 0,
    entriesUnmatchedSource: 0,
    linesUpdated: 0,
    fieldsFilled: { customerId: 0, contractId: 0, subContractId: 0, boqItemId: 0, projectId: 0, employeeId: 0, costCenter: 0 },
    balances: { before: fmt(before), after: {} as Record<string, unknown> },
  };
  const filled = report.fieldsFilled as Record<string, number>;

  // ============ الحساب كاملًا في الذاكرة ============
  type Delta = { lineId: number; customerId: number | null; contractId: number | null; subContractId: number | null; boqItemId: number | null; projectId: number | null; employeeId: number | null; costCenter: string | null };
  const deltas: Delta[] = [];

  const entryIds = entries.map((e) => e.id);
  const allLines = await db.journalLine.findMany({
    where: { entryId: { in: entryIds.length ? entryIds : [0] } },
    select: { id: true, entryId: true, customerId: true, contractId: true, subContractId: true, boqItemId: true, projectId: true, employeeId: true, costCenter: true },
  });
  const linesByEntry = new Map<number, typeof allLines>();
  for (const l of allLines) {
    const list = linesByEntry.get(l.entryId) ?? [];
    list.push(l);
    linesByEntry.set(l.entryId, list);
  }

  for (const e of entries) {
    const v = e.sourceId != null ? vById.get(e.sourceId) : undefined;
    if (!v) {
      report.entriesUnmatchedSource = ((report.entriesUnmatchedSource as number) || 0) + 1;
      continue;
    }
    report.entriesMatched = ((report.entriesMatched as number) || 0) + 1;
    const customerId = v.expenseCustomerId ?? (v.partyType === "customer" ? v.partyId : null) ?? v.contract?.customerId ?? null;

    for (const l of linesByEntry.get(e.id) ?? []) {
      const d: Delta = { lineId: l.id, customerId: null, contractId: null, subContractId: null, boqItemId: null, projectId: null, employeeId: null, costCenter: null };
      let any = false;
      if (l.customerId == null && customerId != null) { d.customerId = customerId; filled.customerId++; any = true; }
      if (l.contractId == null && v.contractId != null) { d.contractId = v.contractId; filled.contractId++; any = true; }
      if (l.subContractId == null && v.subContractId != null) { d.subContractId = v.subContractId; filled.subContractId++; any = true; }
      if (l.boqItemId == null && v.boqItemId != null) { d.boqItemId = v.boqItemId; filled.boqItemId++; any = true; }
      if (l.projectId == null && v.projectId != null) { d.projectId = v.projectId; filled.projectId++; any = true; }
      if (l.employeeId == null && v.advanceEmployeeId != null) { d.employeeId = v.advanceEmployeeId; filled.employeeId++; any = true; }
      if (!l.costCenter && v.costCenter) { d.costCenter = v.costCenter; filled.costCenter++; any = true; }
      if (any) deltas.push(d);
    }
  }

  // ============ تنفيذ دفعة واحدة عبر VALUES JOIN ============
  if (deltas.length > 0) {
    const rowsSql: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const d of deltas) {
      rowsSql.push(`($${p++}::int, $${p++}::int, $${p++}::int, $${p++}::int, $${p++}::int, $${p++}::int, $${p++}::int, $${p++}::text)`);
      params.push(d.lineId, d.customerId, d.contractId, d.subContractId, d.boqItemId, d.projectId, d.employeeId, d.costCenter);
    }
    const sql = `
      UPDATE journal_lines AS l SET
        customer_id     = COALESCE(v.customer_id, l.customer_id),
        contract_id     = COALESCE(v.contract_id, l.contract_id),
        sub_contract_id = COALESCE(v.sub_contract_id, l.sub_contract_id),
        boq_item_id     = COALESCE(v.boq_item_id, l.boq_item_id),
        project_id      = COALESCE(v.project_id, l.project_id),
        employee_id     = COALESCE(v.employee_id, l.employee_id),
        cost_center     = COALESCE(v.cost_center, l.cost_center)
      FROM (VALUES ${rowsSql.join(", ")}) AS v(line_id, customer_id, contract_id, sub_contract_id, boq_item_id, project_id, employee_id, cost_center)
      WHERE l.id = v.line_id`;
    await db.$executeRawUnsafe(sql, ...params);
    report.linesUpdated = deltas.length;
  }

  const after = await companyBalances();
  (report.balances as Record<string, unknown>).after = fmt(after);

  let balanceInvariant = true;
  for (const [co, b] of before) {
    const a = after.get(co);
    if (!a || a.dr !== b.dr || a.cr !== b.cr) balanceInvariant = false;
  }
  report.balanceInvariant = balanceInvariant;

  fs.writeFileSync("db/task106-dims-backfill-report.json", JSON.stringify(report, ser, 2));
  console.log("=== Task 106 dims backfill ===");
  console.log("entries matched:", report.entriesMatched, "| unmatched source:", report.entriesUnmatchedSource);
  console.log("lines updated:", report.linesUpdated, "| fields:", JSON.stringify(report.fieldsFilled));
  console.log("balance invariant (dr/cr unchanged):", balanceInvariant);
  console.log("balances:", JSON.stringify((report.balances as Record<string, unknown>).after));

  await db.$disconnect();
  if (!balanceInvariant) {
    console.error("FATAL: balances changed — rollback required!");
    process.exit(1);
  }
}

main();
