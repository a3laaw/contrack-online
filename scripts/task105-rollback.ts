/**
 * Task 105 — استرجاع مصغر بعد فشل المرور الأول (قراءات بلا فلتر companyId).
 *  1) تصفير حقول السندات الجديدة (account_id/account_snapshot + custody من الأرشفة)
 *  2) حذف الحسابات المُنشأة خطأً (notes تحمل «Task 105»)
 *  3) استرجاع 1140/5300 كأوراق في كل الشركات
 * تشغيل: DB_URL=<pooler> bun scripts/task105-rollback.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const url = process.env.DB_URL ?? "";
if (!url.includes("supabase")) {
  console.error("REFUSED: DB_URL must point at Supabase.");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const snap = JSON.parse(readFileSync("db/voucher-account-fields-snapshot-task105.json", "utf8")) as {
    rows: { id: number; expenseAccountId: number | null; custodyAccountId: number | null; expenseAccountSnapshot: string; custodyAccountSnapshot: string }[];
  };

  // 1) تصفير الحقول الجديدة + استرجاع القيم القديمة للسندات الملموسة
  let fixed = 0;
  const rows = snap.rows.filter((r) => r.expenseAccountId != null || r.custodyAccountId != null);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { Prisma } = await import("@prisma/client");
    const rowsSql = Prisma.join(
      chunk.map((u) => Prisma.sql`(${u.id}::int, ${u.expenseAccountId}::int, ${u.custodyAccountId}::int, ${u.expenseAccountSnapshot}, ${u.custodyAccountSnapshot})`),
    );
    await db.$executeRaw(
      Prisma.sql`UPDATE vouchers SET
        account_id = NULL,
        account_snapshot = NULL,
        expense_account_id = v.ea,
        custody_account_id = v.ca,
        expense_account_snapshot = v.eas,
        custody_account_snapshot = v.cas
      FROM (VALUES ${rowsSql}) AS v(id, ea, ca, eas, cas)
      WHERE vouchers.id = v.id`,
    );
    fixed += chunk.length;
  }
  console.log(`restored legacy fields on ${fixed} vouchers`);

  // سندات قُدّمت بلا حسابات (497): تأكد أنها لا تحمل account_id
  const stray = await db.voucher.updateMany({ where: { accountId: { not: null } }, data: { accountId: null, accountSnapshot: null } });
  console.log(`cleared stray account_id on ${stray.count} vouchers`);

  // 2) حذف الحسابات المُنشأة خطأً
  const del = await db.account.deleteMany({ where: { notes: { contains: "Task 105" } } });
  console.log(`deleted ${del.count} wrongly created accounts`);

  // 3) استرجاع الأبوين كأوراق
  const p = await db.account.updateMany({ where: { code: { in: ["1140", "5300"] } }, data: { isLeaf: true, allowPosting: true } });
  console.log(`restored leaf state on ${p.count} parent accounts (1140/5300)`);

  // 4) أي role غير قياسي على حسابات نظامية (أثر الروابط) — إعادة standard
  const role = await db.account.updateMany({ where: { accountRole: { not: "standard" } }, data: { accountRole: "standard" } });
  console.log(`reset accountRole to standard on ${role.count} accounts`);
  const prof = await db.account.updateMany({ where: { includeInProfitability: false }, data: { includeInProfitability: true } });
  console.log(`reset includeInProfitability=true on ${prof.count} accounts`);
}

main().catch((e) => {
  console.error("ROLLBACK FAILED:", e);
  process.exit(1);
}).finally(() => db.$disconnect());
