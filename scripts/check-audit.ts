import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const rows = await p.$queryRaw<{ts:string; username:string; action:string; entity_type:string; entity_id:number}[]>`
  SELECT ts::text, username, action, entity_type, entity_id FROM audit_log ORDER BY ts DESC LIMIT 15`;
for (const r of rows) console.log(`${r.ts} | ${r.username} | ${r.action} | ${r.entity_type}#${r.entity_id}`);
await p.$disconnect();
