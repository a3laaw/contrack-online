/**
 * Task 104 — ترحيل القيود النصية القديمة (من أرشيف JSON) إلى النموذج الجديد.
 * أداء: معاملة واحدة لكل شركة + إنشاء دفعي (createMany/createManyAndReturn) —
 * 568 قيدًا عبر pooler لا تحتمل معاملة لكل قيد.
 * تشغيل: export $(grep -v '^#' .env | xargs) && bun scripts/task104-migrate-journal.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

interface ArchiveRow {
  id: number;
  companyId: number;
  entryDate: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: string | number;
  projectId?: number | null;
  contractId?: number | null;
  boqItemId?: number | null;
  subContractId?: number | null;
  costCenter?: string;
  sourceType?: string;
  sourceId?: number | null;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync("db/journal-entries-archive-task104.json", "utf8")) as {
    rows: ArchiveRow[];
  };
  const rows = raw.rows;
  const companyIds = Array.from(new Set(rows.map((r) => r.companyId))).sort((a, b) => a - b);
  console.log(`ترحيل ${rows.length} قيدًا قديمًا للشركات: ${companyIds.join(", ")}`);

  const { migrateLegacyJournalRows, resolveLegacyAccountName } = await import(
    "../src/lib/accounting-journal"
  );

  for (const companyId of companyIds) {
    const companyRows = rows.filter((r) => r.companyId === companyId);
    const t0 = Date.now();

    const outcome = await prisma.$transaction(
      async (tx) => {
        // 1) حسابات الشركة + حساب التسوية
        const accounts = await tx.account.findMany({
          where: { companyId, isActive: true },
          select: { id: true, code: true, name: true, allowPosting: true, isActive: true },
        });
        let suspenseId = accounts.find((a) => a.code === "2999")?.id ?? null;
        if (suspenseId == null) {
          const created = await tx.account.create({
            data: {
              companyId,
              code: "2999",
              name: "حساب تسوية مؤقت",
              type: "liability",
              nature: "credit",
              isLeaf: true,
              allowPosting: true,
              isActive: true,
              isSystem: true,
              notes: "يستقبل القيود المرحَّلة التي تعذر حسم حسابها آليًا — يُراجع ويُقفل بتحويلات لاحقة",
              xbrlElement: "kw:SuspenseAccount",
            },
          });
          suspenseId = created.id;
          accounts.push({
            id: created.id,
            code: created.code,
            name: created.name,
            allowPosting: true,
            isActive: true,
          });
        }

        // 2) جسر شجرة المصروفات (اسم قديم → حساب مرتبط)
        const expenseAccounts = await tx.expenseAccount.findMany({
          where: { companyId, accountId: { not: null } },
          select: { name: true, accountId: true },
        });
        const bridge = new Map<string, number>();
        for (const ea of expenseAccounts) {
          if (ea.accountId != null) bridge.set(ea.name.trim(), ea.accountId);
        }

        const candidates = accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          allowPosting: a.allowPosting,
          isActive: a.isActive,
        }));
        const resolve = (name: string): number | null => {
          const rawName = String(name || "").trim();
          if (!rawName) return null;
          const bridged = bridge.get(rawName);
          if (bridged != null) return bridged;
          return resolveLegacyAccountName(rawName, candidates);
        };

        // 3) تحويل نقّي للصفوف
        const mig = migrateLegacyJournalRows(companyRows, resolve, suspenseId);

        // 4) بذر الفترات المالية لكل أشهر القيود
        const monthKeys = Array.from(new Set(mig.entries.map((e) => e.entryDate.slice(0, 7))));
        for (const key of monthKeys) {
          const year = Number(key.slice(0, 4));
          let fy = await tx.fiscalYear.findFirst({ where: { companyId, year }, select: { id: true } });
          if (!fy) {
            fy = await tx.fiscalYear.create({ data: { companyId, year, status: "open" } });
            const periods = Array.from({ length: 12 }, (_, i) => ({
              companyId,
              fiscalYearId: fy!.id,
              periodDate: `${year}-${String(i + 1).padStart(2, "0")}`,
              status: "open",
            }));
            await tx.fiscalPeriod.createMany({ data: periods });
          }
          const per = await tx.fiscalPeriod.findFirst({
            where: { companyId, periodDate: key },
            select: { id: true },
          });
          if (!per) {
            const any = await tx.fiscalPeriod.findFirst({
              where: { companyId, periodDate: { startsWith: `${year}-` } },
              select: { fiscalYearId: true },
            });
            await tx.fiscalPeriod.create({
              data: { companyId, fiscalYearId: any!.fiscalYearId, periodDate: key, status: "open" },
            });
          }
        }

        // 5) الترقيم التعاقبي + إنشاء دفعي للرؤوس ثم الأسطر
        const maxAgg = await tx.journalEntry.aggregate({
          where: { companyId },
          _max: { entryNo: true },
        });
        let entryNo = (maxAgg._max.entryNo ?? 0) + 1;
        const heads = mig.entries.map((e) => ({
          companyId,
          entryNo: entryNo++,
          entryDate: e.entryDate,
          description: e.description,
          status: "posted" as const,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          postedAt: new Date(),
          postedBy: "migration-104",
          createdBy: "migration-104",
        }));
        const createdEntries = await tx.journalEntry.createManyAndReturn({ data: heads });
        const idByNo = new Map<number, number>();
        for (const ce of createdEntries) idByNo.set(ce.entryNo, ce.id);

        const lines: Parameters<typeof tx.journalLine.createMany>[0]["data"] = [];
        mig.entries.forEach((e, idx) => {
          const entryId = idByNo.get(heads[idx].entryNo)!;
          e.lines.forEach((l, i) => {
            lines.push({
              companyId,
              entryId,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              description: l.description || "",
              customerId: l.customerId ?? null,
              contractId: l.contractId ?? null,
              subContractId: l.subContractId ?? null,
              boqItemId: l.boqItemId ?? null,
              projectId: l.projectId ?? null,
              employeeId: l.employeeId ?? null,
              costCenter: l.costCenter || "",
              sort: i,
            });
          });
        });
        for (let i = 0; i < lines.length; i += 400) {
          await tx.journalLine.createMany({ data: lines.slice(i, i + 400) });
        }

        return {
          migrated: mig.entries.length,
          suspenseUsed: mig.suspenseUsed,
          unmatched: Array.from(new Set(mig.unmatched.map((u) => u.name).filter(Boolean))),
        };
      },
      { timeout: 120_000, maxWait: 10_000 }
    );

    console.log(
      `شركة ${companyId}: رُحّل ${outcome.migrated} في ${((Date.now() - t0) / 1000).toFixed(1)}s — تسوية ${outcome.suspenseUsed} طرفًا`
    );
    if (outcome.unmatched.length) console.log(`  غير محسوم: ${outcome.unmatched.join(" | ")}`);
  }

  // تحقق نهائي: توازن الأستاذ لكل شركة
  const balance = await prisma.$queryRawUnsafe<{ company_id: number; d: string; c: string }[]>(`
    SELECT company_id, COALESCE(SUM(debit),0)::text AS d, COALESCE(SUM(credit),0)::text AS c
    FROM journal_lines GROUP BY company_id ORDER BY company_id
  `);
  for (const b of balance) {
    const diff = Math.abs(Number(b.d) - Number(b.c));
    console.log(
      `توازن شركة ${b.company_id}: مدين ${b.d} / دائن ${b.c} — فرق ${diff} ${diff < 0.001 ? "✓" : "✗"}`
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
