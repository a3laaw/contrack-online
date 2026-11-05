/** Safety dump: read every public table via raw SQL and write JSON snapshots. */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const outDir = resolve(import.meta.dir, "..", "db", "supabase-backup-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"));
mkdirSync(outDir, { recursive: true });
const tables = (await p.$queryRaw<{table_name:string}[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`).map(t => t.table_name);
const manifest: Record<string, number> = {};
for (const t of tables) {
  const rows = await p.$queryRawUnsafe<any[]>(`SELECT * FROM "${t}"`);
  manifest[t] = rows.length;
  writeFileSync(resolve(outDir, t + ".json"), JSON.stringify(rows, (_, v) => typeof v === "bigint" ? Number(v) : v));
}
writeFileSync(resolve(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));
const total = Object.values(manifest).reduce((a, b) => a + b, 0);
console.log(`✓ dumped ${tables.length} tables, ${total} rows -> ${outDir}`);
await p.$disconnect();
