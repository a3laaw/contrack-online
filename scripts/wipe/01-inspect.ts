/**
 * فحص الوضع الحالي لقاعدة البيانات — قبل المسح الشامل
 * تشغيل: bun scripts/wipe/01-inspect.ts
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  // كل الجداول مع عدد الصفوف
  const tables = await prisma.$queryRaw<{ table_name: string; row_count: number }[]>`
    SELECT relname AS table_name, n_live_tup::int AS row_count
    FROM pg_stat_user_tables ORDER BY n_live_tup DESC`;
  let total = 0;
  console.log("=== الجداول وعدد الصفوف ===");
  for (const t of tables) {
    if (t.row_count > 0) { console.log(`${t.table_name}: ${t.row_count}`); total += t.row_count; }
  }
  console.log(`-- إجمالي الصفوف في كل الجداول: ${total} (عدد الجداول: ${tables.length})`);

  // الشركات
  const companies = await prisma.$queryRaw<any[]>`SELECT id, name, short_name, is_active, created_at FROM companies ORDER BY id`;
  console.log("\n=== الشركات ===", JSON.stringify(companies, null, 1));

  // المستخدمون
  const users = await prisma.$queryRaw<any[]>`
    SELECT id, username, full_name, role, company_id, is_active
    FROM users ORDER BY company_id, id LIMIT 100`;
  console.log("\n=== المستخدمون ===");
  for (const u of users) console.log(`#${u.id} ${u.username} | role=${u.role} | company=${u.company_id} | active=${u.is_active} | ${u.full_name ?? ""}`);
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
