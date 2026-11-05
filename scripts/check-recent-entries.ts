import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
// recent entries + their lines (dims present? = T106 engine)
const entries = await p.$queryRaw<{id:number; company_id:number; entry_no:number; date:string; status:string; source:string; dims:number}[]>`
  SELECT je.id, je.company_id, je.entry_no, je.entry_date, je.status, je.source_type AS source,
    (SELECT count(*)::int FROM journal_lines jl WHERE jl.entry_id = je.id AND jl.customer_id IS NOT NULL) as dims
  FROM journal_entries je WHERE je.created_at > '2026-11-03' ORDER BY je.id`;
for (const e of entries) console.log(`entry#${e.id} co${e.company_id} no=${e.entry_no} ${e.date} ${e.status} src=${e.source} linesWithCustDims=${e.dims}`);
const lines = await p.$queryRaw<{entry_id:number; code:string; debit:number; credit:number; cust:number; desc_text:string; cust:number}[]>`
  SELECT jl.entry_id, a.code, jl.debit::float, jl.credit::float, jl.description AS desc_text, jl.customer_id AS cust
  FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
  WHERE jl.entry_id IN (SELECT id FROM journal_entries WHERE created_at > '2026-11-03') ORDER BY jl.entry_id, jl.id`;
for (const l of lines) console.log(`  entry#${l.entry_id}: ${l.code} D${l.debit}/C${l.credit} cust=${l.cust} "${l.desc_text.slice(0,40)}"`);
await p.$disconnect();
