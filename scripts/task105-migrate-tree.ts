/**
 * Task 105 — ترحيل دمج الشجرتين: ExpenseAccount → Account + تحويل حقول Voucher.
 * ذري داخل معاملة لكل شركة، نفّذ أولاً على نسخة (أرشفة task105-archive.ts قبلها).
 * تشغيل: DATABASE_URL=<pooler> bun scripts/task105-migrate-tree.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync } from "fs";
import {
  planTreeMerge,
  resolveMergeMap,
  planVoucherFieldMigration,
  verifyFieldMigration,
  type LegacyExpenseAccountRow,
  type AccountCandidate,
  type LegacyVoucherAccountFields,
} from "../src/lib/accounting-merge-core";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL.includes("supabase")) {
  console.error("REFUSED: DATABASE_URL must point at Supabase (pass it explicitly).");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function migrateCompany(companyId: number): Promise<Record<string, unknown>> {
  return db.$transaction(async (tx) => {
    // قراءة الشجرة القديمة + الدليل الموجود — كلها مفلترة بالشركة (درس المرور الفاشل!)
    const eas = (await tx.expenseAccount.findMany({ where: { companyId }, orderBy: { id: "asc" } })) as unknown as LegacyExpenseAccountRow[];
    const accounts = (await tx.account.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true, type: true, isLeaf: true, isActive: true },
      orderBy: { code: "asc" },
    })) as unknown as AccountCandidate[];
    if (accounts.length === 0) throw new Error(`company ${companyId}: الدليل فارغ — بذّره أولاً (Task 104 بذر الشركة 3)`);

    // المستخدم في سندات (مصروف أو عهدة)
    const usedRows = await tx.voucher.findMany({
      where: { companyId, OR: [{ expenseAccountId: { not: null } }, { custodyAccountId: { not: null } }] },
      select: { expenseAccountId: true, custodyAccountId: true },
    });
    const usedExpenseIds = new Set(usedRows.map((v) => v.expenseAccountId).filter((x): x is number => x != null));
    const usedCustodyIds = new Set(usedRows.map((v) => v.custodyAccountId).filter((x): x is number => x != null));

    const plan = planTreeMerge(eas, accounts, usedExpenseIds, usedCustodyIds);

    // 1) تحويل الأب إلى فرع (1140/5300 إن أخذا أبناء) — داخل الشركة حصرًا
    for (const code of plan.leafToBranchCodes) {
      await tx.account.updateMany({ where: { companyId, code, isLeaf: true }, data: { isLeaf: false, allowPosting: false } });
    }

    // 2) إنشاء الحسابات الجديدة
    const parents = new Map((await tx.account.findMany({ where: { companyId, code: { in: ["1140", "5300"] } } })).map((a) => [a.code, a]));
    const createdRows: { eaId: number; accountId: number }[] = [];
    let sortBase = 100;
    for (const c of plan.creates) {
      const parent = parents.get(c.parentCode);
      if (!parent) throw new Error(`company ${companyId}: الأب ${c.parentCode} غير موجود في الدليل`);
      const acc = await tx.account.create({
        data: {
          companyId,
          code: c.code,
          name: c.name,
          type: c.type,
          nature: c.type === "asset" || c.type === "expense" ? "debit" : "credit",
          parentId: parent.id,
          isLeaf: true,
          allowPosting: true,
          isActive: true,
          isSystem: false,
          accountRole: c.accountRole,
          includeInProfitability: c.includeInProfitability,
          notes: `ترحيل من شجرة المصروفات القديمة (حساب #${c.eaId}) — Task 105`,
          sortOrder: sortBase++,
          xbrlElement: c.type === "asset" ? "kw:EmployeeAdvancesReceivable" : "kw:OtherExpenses",
        },
      });
      createdRows.push({ eaId: c.eaId, accountId: acc.id });
    }

    // 3) ضبط role/includeInProfitability على المستهدفين الموجودين
    for (const accountId of plan.custodyRoleOnExisting) {
      await tx.account.update({ where: { id: accountId }, data: { accountRole: "custody" } });
    }
    for (const p of plan.profitabilityOnExisting) {
      await tx.account.update({ where: { id: p.accountId }, data: { includeInProfitability: p.includeInProfitability } });
    }

    // 4) بناء خريطة الحسم ثم تحويل السندات
    const mergeMap = resolveMergeMap(plan, createdRows);
    const createdIds = createdRows.map((c) => c.accountId);
    const allTargets = await tx.account.findMany({
      where: { companyId, id: { in: [...new Set([...mergeMap.values(), ...createdIds])] } },
      select: { id: true, name: true },
    });
    const accountNames = new Map(allTargets.map((a) => [a.id, a.name]));

    const vouchers = (await tx.voucher.findMany({
      where: { companyId, OR: [{ expenseAccountId: { not: null } }, { custodyAccountId: { not: null } }] },
      select: { id: true, expenseAccountId: true, custodyAccountId: true, expenseAccountSnapshot: true, custodyAccountSnapshot: true },
      orderBy: { id: "asc" },
    })) as unknown as LegacyVoucherAccountFields[];

    const { updates, unresolved } = planVoucherFieldMigration(vouchers, mergeMap, accountNames);
    if (unresolved.length) throw new Error(`company ${companyId}: سندات بلا حسم: ${unresolved.join(",")}`);

    // تحديث دفعات عبر SQL VALUES-join (أسرع من 552 استعلامًا عبر pooler)
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      const rowsSql = Prisma.join(
        chunk.map((u) => Prisma.sql`(${u.id}::int, ${u.accountId}::int, ${u.custodyAccountId}::int, ${u.accountSnapshot})`),
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE vouchers SET
           account_id = v.account_id,
           custody_account_id = v.custody_account_id,
           account_snapshot = v.account_snapshot
         FROM (VALUES ${rowsSql}) AS v(id, account_id, custody_account_id, account_snapshot)
         WHERE vouchers.id = v.id AND vouchers.company_id = ${companyId}`,
      );
    }

    // 5) فحوص ما بعد الترحيل (خط ثانٍ بجانب verify)
    const after = (await tx.voucher.findMany({
      where: { companyId, OR: [{ accountId: { not: null } }, { custodyAccountId: { not: null } }] },
      select: { id: true, expenseAccountId: true, custodyAccountId: true, expenseAccountSnapshot: true, custodyAccountSnapshot: true, accountId: true },
      orderBy: { id: "asc" },
    })) as unknown as (LegacyVoucherAccountFields & { accountId: number | null })[];
    const check = verifyFieldMigration(
      vouchers,
      after.map((r) => ({ id: r.id, accountId: r.accountId, custodyAccountId: r.custodyAccountId, accountSnapshot: r.accountSnapshot ?? null })),
    );
    if (!check.ok) throw new Error(`company ${companyId}: فشل التحقق: ${check.errors.join(" | ")}`);

    return {
      companyId,
      links: plan.links.length,
      creates: plan.creates.length,
      skipped: plan.skipped.length,
      custodyRoleSet: plan.custodyRoleOnExisting.length,
      vouchersUpdated: updates.length,
      plan,
      createdRows,
    };
  }, { timeout: 90_000, maxWait: 15_000 });
}

async function main() {
  const companies = await db.company.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const results: Record<string, unknown>[] = [];
  for (const c of companies) {
    console.log(`— migrating company ${c.id} …`);
    const r = await migrateCompany(c.id);
    results.push(r);
    console.log(`  links=${r.links} creates=${r.creates} skipped=${r.skipped} vouchers=${r.vouchersUpdated}`);
    const plan = r.plan as { links: { eaId: number; accountId: number; method: string }[]; creates: unknown[]; skipped: { eaId: number; name: string; reason: string }[] };
    for (const l of plan.links) console.log(`    link: ea#${l.eaId} → acc#${l.accountId} (${l.method})`);
    for (const s of plan.skipped) console.log(`    skip: ea#${s.eaId} «${s.name}» — ${s.reason}`);
  }
  writeFileSync("db/expense-tree-migration-report-task105.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  console.log("DONE — report saved to db/expense-tree-migration-report-task105.json");
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e);
  process.exit(1);
}).finally(() => db.$disconnect());
