/**
 * فحص المستخدمين والبنية — قبل المسح
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  // أعمدة جدول المستخدمين
  const cols = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'users' ORDER BY ordinal_position`;
  console.log("=== أعمدة users ===");
  console.log(cols.map((c) => c.column_name).join(", "));

  // المستخدمون
  const users = await prisma.$queryRaw<any[]>`SELECT * FROM users ORDER BY id LIMIT 100`;
  console.log("\n=== المستخدمون ===");
  for (const u of users) {
    console.log(
      `#${u.id} | ${u.username} | role=${u.role} | company=${(u as any).company_id} | ${u.full_name ?? u.name ?? ""}`
    );
  }

  // خطط واشتراكات
  const plans = await prisma.$queryRaw<any[]>`SELECT * FROM plans ORDER BY id`;
  console.log("\n=== plans ===");
  for (const p of plans) console.log(JSON.stringify(p));
  const subs = await prisma.$queryRaw<any[]>`SELECT * FROM subscriptions ORDER BY id`;
  console.log("\n=== subscriptions ===");
  for (const s of subs) console.log(JSON.stringify(s));

  // هل توجد جداول انضمام/طلبات؟
  const allTables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log("\n=== كل الجداول (117) ===");
  console.log(allTables.map((t) => t.table_name).join(", "));
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 500));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
