/**
 * فحص: الأعلام، الإعدادات، صف المطور
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const flags = await prisma.$queryRaw<any[]>`SELECT row_to_json(f) AS row FROM feature_flags f ORDER BY f.key`;
  console.log("=== feature_flags ===");
  for (const f of flags) console.log(f.row);

  const settings = await prisma.$queryRaw<any[]>`SELECT row_to_json(s) AS row FROM settings s`;
  console.log("\n=== settings ===");
  for (const s of settings) console.log(JSON.stringify(s.row).slice(0, 400));

  const dev = await prisma.$queryRaw<any[]>`SELECT row_to_json(u) AS row FROM users u WHERE u.role = 'developer'`;
  console.log("\n=== صف المطور ===");
  for (const d of dev) console.log(d.row);
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
