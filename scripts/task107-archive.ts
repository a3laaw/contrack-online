/**
 * Task 107 — أرشفة الفواتير القديمة قبل أي تغيير مخطط (قاعدة 1: نسخة احتياطية قبل أي ترحيل).
 * تصعد كل صف invoices بالهيكل القديم (invoiceNumber/customerId/contractId/invoiceDate/
 * description/amount/notes) إلى db/invoices-archive-task107.json.
 * تشغيل: bun scripts/task107-archive.ts
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.invoice.findMany({ orderBy: { id: "asc" } });
  const out = {
    archivedAt: new Date().toISOString(),
    count: rows.length,
    byCompany: rows.reduce<Record<string, number>>((acc, r) => {
      acc[String(r.companyId)] = (acc[String(r.companyId)] || 0) + 1;
      return acc;
    }, {}),
    rows,
  };
  writeFileSync("db/invoices-archive-task107.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`أُرشفت ${rows.length} فاتورة قديمة → db/invoices-archive-task107.json`);
  console.log("حسب الشركة:", JSON.stringify(out.byCompany));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
