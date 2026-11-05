import { PrismaClient } from "@prisma/client";
const url = process.env.DIRECT_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const tables = await prisma.$queryRaw<{table_name:string}[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log("Tables in Supabase:");
  for (const t of tables) {
    let n = 0;
    try {
      const r = await prisma.$queryRawUnsafe<{n:number}[]>(`SELECT count(*)::int as n FROM "${t.table_name}"`);
      n = r[0]?.n ?? 0;
    } catch { n = -1; }
    console.log(`  ${t.table_name}: ${n} rows`);
  }
} catch (e: any) { console.error("✗", e.message?.slice(0,300)); process.exit(1); }
finally { await prisma.$disconnect(); }
