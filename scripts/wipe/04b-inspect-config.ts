/**
 * فحص بنية جداول الإعدادات
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  for (const t of ["user_permissions", "feature_flags", "settings", "registration_requests", "users"]) {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name = ${t} ORDER BY ordinal_position`;
    console.log(`${t}: ${cols.map((c) => c.column_name).join(", ")}`);
  }

  const perms = await prisma.$queryRaw<any[]>`SELECT row_to_json(p) AS row FROM user_permissions p LIMIT 100`;
  console.log("\n=== user_permissions ===");
  for (const p of perms) console.log(p.row);

  const flags = await prisma.$queryRaw<any[]>`SELECT row_to_json(f) AS row FROM feature_flags f ORDER BY 1`;
  console.log("\n=== feature_flags ===");
  for (const f of flags) console.log(f.row);

  const settings = await prisma.$queryRaw<any[]>`SELECT row_to_json(s) AS row FROM settings s`;
  console.log("\n=== settings ===");
  for (const s of settings) console.log(s.row);

  const dev = await prisma.$queryRaw<any[]>`SELECT row_to_json(u) AS row FROM users u WHERE u.role = 'developer'`;
  console.log("\n=== صف المطور ===");
  for (const d of dev) console.log(d.row);
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
