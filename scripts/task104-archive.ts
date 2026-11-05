/**
 * Task 104 — أرشفة القيود النصية القديمة قبل إعادة هيكلة الجدول.
 * يصعّد كل صفوف journal_entries (كل الشركات) إلى JSON قبل db:push الذي يُسقط أعمدة النصوص.
 * تشغيل: bun scripts/task104-archive.ts
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.journalEntry.findMany({ orderBy: { id: "asc" } });
  const out = {
    archivedAt: new Date().toISOString(),
    reason: "Task 104 — أرشفة القيود النصية القديمة قبل إعادة الهيكلة",
    count: rows.length,
    rows,
  };
  const path = "db/journal-entries-archive-task104.json";
  writeFileSync(path, JSON.stringify(out, null, 1), "utf8");
  console.log(`أُرشِف ${rows.length} قيدًا نصيًا إلى ${path}`);
  const byCompany = new Map<number, number>();
  for (const r of rows) byCompany.set(r.companyId, (byCompany.get(r.companyId) || 0) + 1);
  for (const [c, n] of byCompany) console.log(`  شركة ${c}: ${n}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
