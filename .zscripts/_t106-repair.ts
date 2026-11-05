import { PrismaClient } from "@prisma/client";
import { POSTING_RULE_CATALOG, resolveSeedableCode, type SeedChartAccount } from "../src/lib/posting-rules-core";
const db = new PrismaClient();
const main = async () => {
  const companies = await db.company.findMany({ select: { id: true, name: true } });
  for (const c of companies) {
    const chart = (await db.account.findMany({
      where: { companyId: c.id, isActive: true },
      select: { code: true, isLeaf: true, allowPosting: true, isActive: true },
    })) as SeedChartAccount[];
    const resolve = (bp: string) => resolveSeedableCode(bp, chart);
    const existing = await db.postingRule.findMany({ where: { companyId: c.id } });
    const byKey = new Map(existing.map((r) => [r.ruleKey, r]));
    let created = 0, repaired = 0;
    for (const def of POSTING_RULE_CATALOG) {
      const row = byKey.get(def.key);
      if (!row) {
        await db.postingRule.create({ data: { companyId: c.id, ruleKey: def.key, label: def.label, debitCode: resolve(def.defaultDebitCode), creditCode: resolve(def.defaultCreditCode), enabled: true, isSystem: true } });
        created++;
        continue;
      }
      if (!row.isSystem) continue;
      const patch: { debitCode?: string; creditCode?: string } = {};
      const resolvable = (code: string) => resolveSeedableCode(code, chart) === code;
      if (row.debitCode && !resolvable(row.debitCode)) patch.debitCode = resolve(def.defaultDebitCode);
      if (row.creditCode && !resolvable(row.creditCode)) patch.creditCode = resolve(def.defaultCreditCode);
      if (Object.keys(patch).length) { await db.postingRule.update({ where: { id: row.id }, data: patch }); repaired++; }
    }
    console.log(`co${c.id} (${c.name}): created=${created} repaired=${repaired}`);
  }
  const rules = await db.postingRule.findMany({ where: { ruleKey: { in: ["salary_deduction", "bank_fee"] } }, orderBy: [{ companyId: "asc" }, { ruleKey: "asc" }] });
  for (const r of rules) console.log(`co${r.companyId} ${r.ruleKey}: dr=${r.debitCode} cr=${r.creditCode}`);
};
main().finally(() => db.$disconnect());
