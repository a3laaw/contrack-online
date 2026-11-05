import { PrismaClient } from "@prisma/client";
const url = process.env.DIRECT_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  // 1) T105: unified chart — codes 530001/114001 exist?
  const merged = await prisma.$queryRaw<{n:number}[]>`SELECT count(*)::int as n FROM accounts WHERE code LIKE '530001%' OR code LIKE '114001%'`;
  console.log("T105 merged-chart leaf codes (530001*/114001*):", merged[0].n);

  // 2) T106: journal_lines with customer dims backfilled?
  const dims = await prisma.$queryRaw<{tot:number; withCust:number}[]>`SELECT count(*)::int as tot, count(customer_id)::int as "withCust" FROM journal_lines`;
  console.log(`T106 line dims: ${dims[0].withCust}/${dims[0].tot} lines carry customer_id`);

  // 3) T106: posting rules per company
  const rules = await prisma.$queryRaw<{company_id:number; n:number}[]>`SELECT company_id, count(*)::int as n FROM posting_rules GROUP BY company_id`;
  console.log("T106 posting rules:", JSON.stringify(rules));

  // 4) GL balance per company (posted entries only)
  const gl = await prisma.$queryRaw<{company_id:number; dr:number; cr:number}[]>`
    SELECT jl.company_id, COALESCE(SUM(jl.debit),0)::float as dr, COALESCE(SUM(jl.credit),0)::float as cr
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
    WHERE je.status = 'posted' GROUP BY jl.company_id`;
  for (const g of gl) console.log(`GL company ${g.company_id}: ${g.dr} / ${g.cr} diff ${(g.dr-g.cr).toFixed(3)}`);

  // 5) number_sequences (invoice counter seeded?)
  const seq = await prisma.$queryRaw<{company_id:number; name:string; current:number}[]>`SELECT company_id, name, last_no FROM number_sequences ORDER BY company_id, name`;
  console.log("number_sequences:", JSON.stringify(seq));

  // 6) audit_log recency
  const au = await prisma.$queryRaw<{mx:string}[]>`SELECT max(ts)::text as mx FROM audit_log`;
  console.log("audit_log latest:", au[0].mx);
  const ce = await prisma.$queryRaw<{mx:string}[]>`SELECT max(event_time)::text as mx FROM contract_events`;
  console.log("contract_events latest:", ce[0].mx);

  // 7) entry number counter vs max entryNo
  const mx = await prisma.$queryRaw<{company_id:number; mx:number}[]>`SELECT company_id, max(entry_no) as mx FROM journal_entries GROUP BY company_id`;
  console.log("max entry_no per company:", JSON.stringify(mx));
} catch (e:any) { console.error("✗", e.message?.slice(0,400)); process.exit(1); }
finally { await prisma.$disconnect(); }
