/**
 * نسخة احتياطية كاملة قبل المسح — كل جداول public إلى ملفات JSON
 * تشغيل: bun scripts/wipe/05-backup.ts
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = `/home/z/my-project/backups/pre-wipe-${stamp}`;

try {
  mkdirSync(dir, { recursive: true });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;

  const manifest: Record<string, number> = {};
  let totalRows = 0;

  for (const { tablename } of tables) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT row_to_json(t) AS row FROM "${tablename}" t`
    );
    const data = rows.map((r) => r.row);
    if (data.length > 0) {
      writeFileSync(`${dir}/${tablename}.json`, JSON.stringify(data, null, 1));
      manifest[tablename] = data.length;
      totalRows += data.length;
    }
  }

  writeFileSync(`${dir}/_manifest.json`, JSON.stringify({ stamp, tables: manifest, totalRows }, null, 2));
  console.log(`✓ النسخة الاحتياطية جاهزة: ${dir}`);
  console.log(`✓ جداول ببيانات: ${Object.keys(manifest).length} | إجمالي الصفوف: ${totalRows}`);
  console.log(JSON.stringify(manifest, null, 1));
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
