/**
 * عدّاد دقيق لكل جداول public + صلاحيات المطور
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log(`عدد جداول public: ${tables.length}`);

  let total = 0;
  const nonEmpty: string[] = [];
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${t.tablename}"`
    );
    if (r[0].n > 0) {
      nonEmpty.push(`${t.tablename}=${r[0].n}`);
      total += r[0].n;
    }
  }
  console.log("=== الجداول غير الفارغة (عدّ دقيق) ===");
  console.log(nonEmpty.join("\n"));
  console.log(`-- الإجمالي: ${total}`);

  // صلاحيات المستخدمين
  const perms = await prisma.$queryRaw<any[]>`SELECT * FROM user_permissions ORDER BY id LIMIT 50`;
  console.log("\n=== user_permissions ===");
  console.log(perms.length ? JSON.stringify(perms) : "(فارغة)");

  // طلبات التسجيل
  const reg = await prisma.$queryRaw<any[]>`SELECT * FROM registration_requests ORDER BY id LIMIT 20`;
  console.log("\n=== registration_requests ===");
  console.log(reg.length ? JSON.stringify(reg, null, 1) : "(فارغة)");

  // صف المطور كاملًا (سنعيد إدراجه بعد المسح)
  const dev = await prisma.$queryRaw<any[]>`SELECT row_to_json(u) AS row FROM users u WHERE u.role = 'developer'`;
  console.log("\n=== صف المطور (سيُحفظ) ===");
  console.log(JSON.stringify(dev));
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
