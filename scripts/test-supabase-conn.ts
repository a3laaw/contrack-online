import { PrismaClient } from "@prisma/client";
const url = process.env.DIRECT_URL!;
console.log("Testing:", url.replace(/:[^:@]+@/, ":***@"));
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const r = await prisma.$queryRaw`SELECT version() as v, current_database() as db`;
  console.log("✓ CONNECTED:", JSON.stringify(r));
  const tables = await prisma.$queryRaw`SELECT count(*)::int as n FROM information_schema.tables WHERE table_schema='public'`;
  console.log("public tables:", JSON.stringify(tables));
} catch (e: any) {
  console.error("✗ FAILED:", e.message?.slice(0, 300));
  process.exit(1);
} finally { await prisma.$disconnect(); }
