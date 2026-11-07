/**
 * استكمال إعادة البذر بعد المسح (استئناف من النسخة الاحتياطية)
 * الحالة عند التشغيل: users=1 (مطور) — plans و feature_flags فارغة
 * تشغيل: bun scripts/wipe/07-resume-seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const backupDir = "/home/z/my-project/backups/pre-wipe-2026-11-07T07-29-03";

try {
  // 1) الخطط من النسخة الاحتياطية
  const plans = JSON.parse(readFileSync(`${backupDir}/plans.json`, "utf8"));
  for (const p of plans) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO plans (id, code, name, duration_days, max_users, max_divisions, price_monthly, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9)`,
      p.id, p.code, p.name, p.duration_days, p.max_users, p.max_divisions, String(p.price_monthly), p.is_active, p.sort_order
    );
  }
  console.log(`✓ الخطط: ${plans.length}`);

  // 2) الأعلام من النسخة الاحتياطية
  const flags = JSON.parse(readFileSync(`${backupDir}/feature_flags.json`, "utf8"));
  for (const f of flags) {
    await prisma.$executeRawUnsafe(`INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)`, f.key, f.enabled);
  }
  console.log(`✓ الأعلام: ${flags.length}`);

  // 3) ضبط عدّادات التسلسل
  for (const t of ["users", "plans"]) {
    const seq = await prisma.$queryRaw<{ seq: string | null }[]>`
      SELECT pg_get_serial_sequence(${t}, 'id') AS seq`;
    if (seq[0]?.seq) {
      await prisma.$executeRawUnsafe(
        `SELECT setval('${seq[0].seq}', GREATEST(COALESCE((SELECT MAX(id) FROM "${t}"), 1), 1))`
      );
    }
  }
  console.log("✓ عدّادات التسلسل");

  // 4) تحقق نهائي
  const after = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  let nonEmpty = 0;
  const details: string[] = [];
  for (const { tablename } of after) {
    const r = await prisma.$queryRawUnsafe<{ n: number }>(`SELECT count(*)::int AS n FROM "${tablename}"`);
    if (r[0].n > 0) { nonEmpty++; details.push(`${tablename}=${r[0].n}`); }
  }
  console.log(`\n=== بعد المسح: جداول غير فارغة (${nonEmpty}) ===`);
  console.log(details.join(" | "));
  console.log(nonEmpty === 3 ? "\n✓✓ النظام نظيف — حالة أول تشغيل" : "\n⚠ تحقق يدوي");
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 600));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
