/**
 * فحص تفصيلي: الصلاحيات، الأعلام، الإعدادات، صف المطور
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const perms = await prisma.$queryRaw<any[]>`SELECT * FROM user_permissions ORDER BY id LIMIT 100`;
  console.log("=== user_permissions (" + perms.length + ") ===");
  for (const p of perms) console.log(JSON.stringify(p));

  const flags = await prisma.$queryRaw<any[]>`SELECT * FROM feature_flags ORDER BY id`;
  console.log("\n=== feature_flags (" + flags.length + ") ===");
  for (const f of flags) console.log(JSON.stringify(f));

  const settings = await prisma.$queryRaw<any[]>`SELECT * FROM settings ORDER BY id`;
  console.log("\n=== settings (" + settings.length + ") ===");
  for (const s of settings) console.log(JSON.stringify(s));

  const dev = await prisma.$queryRaw<any[]>`SELECT row_to_json(u) AS row FROM users u WHERE u.role = 'developer'`;
  console.log("\n=== صف المطور ===");
  console.log(JSON.stringify(dev));

  const reg = await prisma.$queryRaw<any[]>`SELECT * FROM registration_requests ORDER BY id`;
  console.log("\n=== registration_requests (" + reg.length + ") ===");
  for (const r of reg) console.log(JSON.stringify(r));
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
