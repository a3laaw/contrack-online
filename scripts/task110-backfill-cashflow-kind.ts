/**
 * Task 110 — بذر تصنيف التدفق النقدي الافتراضي على الدليل القائم (idempotent).
 * يملأ cashFlowKind الفارغ فقط حسب الاشتقاق الهيكلي الموثق في financial-statements-core:
 *   النقد 111x → "" (هو موضوع القائمة) · إيراد/مصروف → تشغيلي · أصول 12xx → استثماري ·
 *   حقوق ملكية 3xxx والتزامات 22xx → تمويلي · الباقي تشغيلي.
 * الاستخدام:
 *   DIRECT_URL="postgresql://..." bun scripts/task110-backfill-cashflow-kind.ts
 */
import { PrismaClient } from "@prisma/client";
import { defaultCashFlowKind } from "../src/lib/financial-statements-core";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "" } } });

async function main() {
  const accounts = await prisma.account.findMany({
    select: { id: true, code: true, name: true, type: true, cashFlowKind: true },
    orderBy: [{ companyId: "asc" }, { code: "asc" }],
  });
  let filled = 0;
  for (const a of accounts) {
    if ((a.cashFlowKind || "").trim()) continue;
    const kind = defaultCashFlowKind(a.code, a.type);
    if (!kind) continue; // النقد يبقى بلا تصنيف صريح (الاشتقاق يعطي "" داخل المحرك)
    await prisma.account.update({ where: { id: a.id }, data: { cashFlowKind: kind } });
    filled++;
    console.log(`  ✓ ${a.code} ${a.name} → ${kind}`);
  }
  console.log(`✓ تم تعبئة ${filled} حسابًا من ${accounts.length} — البقية إما مصنفة سلفًا أو نقدية (111x).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
