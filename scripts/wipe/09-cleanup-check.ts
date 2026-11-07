/**
 * تنظيف آثار الفحص: حذف المستخدم المؤقت وسجلات التدقيق الخاصة به + تحقق نهائي
 * تشغيل: bun scripts/wipe/09-cleanup-check.ts
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  // 1) حذف المستخدم المؤقت
  const del = await prisma.$executeRawUnsafe(
    `DELETE FROM users WHERE username = '__wipe_check'`
  );
  console.log(`✓ حُذف المستخدم المؤقت: ${del} صف`);

  // 2) حذف آثار الفحص من سجل التدقيق (دخول/خروج __wipe_check)
  const delAudit = await prisma.$executeRawUnsafe(
    `DELETE FROM audit_log WHERE username = '__wipe_check' OR entity_name LIKE '%__wipe_check%'`
  );
  console.log(`✓ حُذفت آثار الفحص من audit_log: ${delAudit} صف`);

  // 3) تحقق نهائي شامل
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  let nonEmpty = 0;
  const details: string[] = [];
  for (const { tablename } of tables) {
    const r = await prisma.$queryRawUnsafe<{ n: number }>(`SELECT count(*)::int AS n FROM "${tablename}"`);
    if (r[0].n > 0) { nonEmpty++; details.push(`${tablename}=${r[0].n}`); }
  }
  console.log(`\n=== الحالة النهائية (${nonEmpty} جداول غير فارغة) ===`);
  console.log(details.join(" | "));

  // 4) المستخدمون المتبقون
  const users = await prisma.$queryRaw<any[]>`SELECT id, username, role, company_id FROM users ORDER BY id`;
  console.log("\n=== المستخدمون ===");
  for (const u of users) console.log(`#${u.id} ${u.username} (${u.role})`);
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
