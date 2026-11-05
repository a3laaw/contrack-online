import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const rows = await p.$queryRaw<{id:number; entry_no:number; status:string; source_type:string; created_by:string; posted_by:string; created_at:string; desc:string}[]>`
  SELECT id, entry_no, status, source_type, created_by, posted_by, created_at::text, description AS desc_text
  FROM journal_entries WHERE id >= 556 ORDER BY id`;
for (const r of rows) console.log(`#${r.id} no=${r.entry_no} ${r.status} src=${r.source_type} by="${r.created_by}"/"${r.posted_by}" at=${r.created_at} "${r.desc_text.slice(0,50)}"`);
const v = await p.$queryRaw<{id:number; company_id:number; type:string; amount:number; created_at:string; created_by:string}[]>`
  SELECT id, company_id, vtype, amount::float, created_at::text, created_by FROM vouchers WHERE id >= 556 ORDER BY id`;
console.log("--- vouchers ---");
for (const r of v) console.log(`voucher#${r.id} co${r.company_id} ${r.vtype} ${r.amount} at=${r.created_at} by=${r.created_by}`);
await p.$disconnect();
