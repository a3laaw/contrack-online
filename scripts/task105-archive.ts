/**
 * Task 105 — أرشفة قبل أي ترحيل (قاعدة التنفيذ الثابتة رقم 1).
 * يصعّد إلى db/:
 *  1) expense-accounts-tree-archive-task105.json — شجرة ExpenseAccount كاملة (تُسقَط لاحقًا)
 *  2) voucher-account-fields-snapshot-task105.json — لقطات الحقول القديمة للسندات
 *     (expense_account_id / custody_account_id / snapshotين) — تُستبدل بأعمدة جديدة
 * تشغيل: DATABASE_URL=... bun scripts/task105-archive.ts
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL.includes("supabase")) {
  console.error("REFUSED: DATABASE_URL must point at Supabase (pass it explicitly).");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function main() {
  const tree = await db.expenseAccount.findMany({
    orderBy: [{ companyId: "asc" }, { id: "asc" }],
  });
  const vouchers = await db.voucher.findMany({
    select: {
      id: true,
      companyId: true,
      voucherNumber: true,
      expenseAccountId: true,
      custodyAccountId: true,
      expenseAccountSnapshot: true,
      custodyAccountSnapshot: true,
      expenseGroupRef: true,
      vtype: true,
      cancelled: true,
    },
    orderBy: { id: "asc" },
  });

  const treePath = "db/expense-accounts-tree-archive-task105.json";
  const vouchPath = "db/voucher-account-fields-snapshot-task105.json";
  writeFileSync(treePath, JSON.stringify({ archivedAt: new Date().toISOString(), model: "expense_accounts", rows: tree }, null, 1));
  writeFileSync(vouchPath, JSON.stringify({ archivedAt: new Date().toISOString(), model: "vouchers:legacy_account_fields", rows: vouchers }, null, 1));

  const byCompany = new Map<number, number>();
  for (const r of tree) byCompany.set(r.companyId, (byCompany.get(r.companyId) ?? 0) + 1);
  const bridged = tree.filter((t) => t.accountId != null).length;
  console.log(`archived expense_accounts: ${tree.length} rows (bridged: ${bridged}) — ${treePath}`);
  for (const [c, n] of byCompany) console.log(`  company ${c}: ${n} rows`);
  console.log(`archived voucher legacy fields: ${vouchers.length} rows — ${vouchPath}`);
  const withExpense = vouchers.filter((v) => v.expenseAccountId != null).length;
  const withCustody = vouchers.filter((v) => v.custodyAccountId != null).length;
  console.log(`  vouchers with expenseAccountId: ${withExpense}, with custodyAccountId: ${withCustody}`);
}

main().catch((e) => {
  console.error("ARCHIVE FAILED:", e);
  process.exit(1);
}).finally(() => db.$disconnect());
