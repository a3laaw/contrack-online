import { PrismaClient } from "@prisma/client";
const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const KEY = ["companies","users","contracts","customers","journal_entries","journal_lines","vouchers","accounts","invoices","fiscal_years","fiscal_periods","posting_rules","voucher_payment_links","audit_log","contract_events","sub_contracts","projects","payment_plan","fiscal_closing","entity_backups"];
try {
  for (const t of KEY) {
    try {
      const r = await prisma.$queryRawUnsafe<{n:number}[]>(`SELECT count(*)::int as n FROM "${t}"`);
      console.log(`  ${t}: ${r[0]?.n}`);
    } catch (e:any) { console.log(`  ${t}: MISSING (${e.message.slice(0,60)})`); }
  }
} finally { await prisma.$disconnect(); }
