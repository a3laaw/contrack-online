/**
 * Task 107 — ترحيل الفواتير القديمة (من أرشيف JSON) إلى الهيكل الجديد:
 * كل فاتورة قديمة = فاتورة legacy=true بلا قيد (أموالها حُصّلت تحت نموذج النصوص
 * قبل النواة المزدوجة — التخصيص المستقبلي مستبعد عنها لتجنب إيراد/ذمم وهمية):
 *   invoiceNo من رقمها (INV-####) أو تسلسلي، subtotal/total من amount،
 *   status=unpaid، وبند واحد (الوصف/كمية 1/سعر المبلغ).
 * تشغيل بعد db:push: bun scripts/task107-migrate-invoices.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();

interface ArchiveRow {
  id: number;
  companyId: number;
  invoiceNumber: string;
  customerId: number;
  contractId: number | null;
  invoiceDate: string;
  description: string;
  amount: string | number;
  notes: string;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync("db/invoices-archive-task107.json", "utf8")) as { rows: ArchiveRow[] };
  const rows = raw.rows;
  const companyIds = Array.from(new Set(rows.map((r) => r.companyId))).sort((a, b) => a - b);
  console.log(`ترحيل ${rows.length} فاتورة قديمة للشركات: ${companyIds.join(", ")}`);

  let migrated = 0;
  for (const companyId of companyIds) {
    const companyRows = rows.filter((r) => r.companyId === companyId);
    await prisma.$transaction(
      async (tx) => {
        // أعلى invoiceNo موجودة في هذه الشركة (حماية من تصادم الأرقام المرحَّلة)
        const maxNo = await tx.invoice.aggregate({ where: { companyId }, _max: { invoiceNo: true } });
        let seq = (maxNo._max.invoiceNo ?? 0) + 100000; // نطاق آمن للأرقام غير القابلة للتحليل
        for (const row of companyRows) {
          const amount = Number(row.amount);
          if (!(amount > 0)) continue;
          const parsed = Number(String(row.invoiceNumber).replace(/^INV-/, ""));
          const invoiceNo = Number.isFinite(parsed) && parsed > 0 ? parsed : seq++;
          // هل الرقم محجوز بفاتورة أخرى في نفس الشركة؟ (مرحَّلة سابقًا) ⇒ تسلسلي
          const clash = await tx.invoice.findFirst({
            where: { companyId, invoiceNo, id: { not: row.id } },
            select: { id: true },
          });
          const finalNo = clash ? seq++ : invoiceNo;
          await tx.invoice.update({
            where: { id: row.id },
            data: {
              invoiceNo: finalNo,
              subtotal: amount,
              discountTotal: 0,
              total: amount,
              paidAmount: 0,
              status: "unpaid",
              legacy: true,
              dueDate: "",
            },
          });
          await tx.invoiceItem.create({
            data: {
              companyId,
              invoiceId: row.id,
              description: row.description || `قيمة الفاتورة ${row.invoiceNumber}`,
              quantity: 1,
              unitPrice: amount,
              discountPct: 0,
              lineTotal: amount,
              sortOrder: 0,
            },
          });
          migrated++;
        }
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
    console.log(`الشركة ${companyId}: ${companyRows.length} فاتورة`);
  }

  // تقرير
  const remainingLegacy = await prisma.invoice.count({ where: { legacy: true } });
  const withItems = await prisma.invoiceItem.count();
  writeFileSync(
    "db/invoice-migration-report-task107.json",
    JSON.stringify({ migrated, remainingLegacy, withItems }, null, 2),
    "utf8"
  );
  console.log(`مُرحَّلة: ${migrated} · legacy الآن: ${remainingLegacy} · بنود: ${withItems}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
