/**
 * أداة الترحيل: SQLite (db/custom.db) → Supabase Postgres
 * ========================================================
 * تُشغَّل بعد تبديل prisma/schema.prisma إلى provider="postgresql" وتنفيذ `bunx prisma db push`
 * على مشروع Supabase (تنشئ الجداول الفارغة). ثم يقرأ هذا السكربت ملف SQLite مباشرة
 * (عبر bun:sqlite — بلا حاجة لعميل Prisma لـ SQLite) ويُدخل الصفوف في Postgres
 * عبر عميل Prisma (المولَّد بـ postgresql provider) باستعلامات معامَلة (parameterized).
 *
 * الاستخدام:
 *   DATABASE_URL="postgresql://..." bun scripts/migrate-to-supabase.ts
 *
 * ما يفعله بالترتيب:
 *   1) يقرأ قائمة الجداول من sqlite_master (مع تجاهل sqlite_% و _prisma_migrations)
 *   2) يبني ترتيبًا طوبولوجيًا من قيود FK في Postgres (الأب قبل الابن — Kahn)
 *   3) يفرّغ الجداول الهدف (TRUNCATE ... CASCADE دفعة واحدة) لجعل التشغيل قابلًا للتكرار
 *   4) يُدخل الصفوف دفعةً-دفعة داخل معاملة واحدة لكل جدول مع تحويل الأنواع:
 *      - 0/1 → boolean حسب نوع العمود في Postgres
 *      - النصوص والأرقام تمر كما هي (التواريخ نصية YYYY-MM-DD في هذا المشروع)
 *   5) يعيد ضبط تسلسل id (setval) لكل جدول ذي عمود serial
 *   6) يقارن عدد الصفوف (SQLite مقابل Postgres) ويطبع تقريرًا نهائيًا
 */
import { Database } from "bun:sqlite";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SQLITE_PATH = process.env.SQLITE_PATH || resolve(import.meta.dir, "..", "db", "custom.db");
const PG_URL = process.env.DATABASE_URL || process.env.DIRECT_URL || "";

if (!PG_URL || !PG_URL.startsWith("postgresql")) {
  console.error("✗ DATABASE_URL يجب أن يكون رابط Postgres (Supabase). مثال:");
  console.error('  DATABASE_URL="postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres" bun scripts/migrate-to-supabase.ts');
  process.exit(1);
}
if (!existsSync(SQLITE_PATH)) {
  console.error(`✗ ملف SQLite غير موجود: ${SQLITE_PATH}`);
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const prisma = new PrismaClient({ datasources: { db: { url: PG_URL } } });

type ColInfo = { name: string; pgType: string };
const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const SKIP_TABLES = new Set(["_prisma_migrations"]);

/** epoch millis (كما يخزنها Prisma في SQLite) → 'YYYY-MM-DD HH:MM:SS.sss' بتوقيت UTC */
function epochToTsString(v: number): string {
  const d = new Date(v);
  return (
    d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0") +
    " " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + ":" +
    String(d.getUTCSeconds()).padStart(2, "0") + "." + String(d.getUTCMilliseconds()).padStart(3, "0")
  );
}

async function main() {
  // 1) جداول SQLite
  const sqliteTables = sqlite
    .prepare<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map((r) => r.name)
    .filter((t) => !SKIP_TABLES.has(t));

  // جداول Postgres الموجودة (بعد db push)
  const pgTablesRes: { table_name: string }[] =
    await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
    );
  const pgTables = new Set(pgTablesRes.map((r) => r.table_name));

  const missing = sqliteTables.filter((t) => !pgTables.has(t));
  if (missing.length) {
    console.error(`✗ جداول في SQLite غير موجودة في Postgres (نفّذ db push أولًا): ${missing.join(", ")}`);
    process.exit(1);
  }

  // أنواع أعمدة Postgres (لتحويل boolean)
  const colsRes: { table_name: string; column_name: string; data_type: string }[] =
    await prisma.$queryRawUnsafe(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`
    );
  const pgCols = new Map<string, ColInfo[]>();
  for (const c of colsRes) {
    const list = pgCols.get(c.table_name) || [];
    list.push({ name: c.column_name, pgType: c.data_type });
    pgCols.set(c.table_name, list);
  }

  // 2) ترتيب طوبولوجي حسب FK
  const fkRes: { tbl: string; ref: string }[] = await prisma.$queryRawUnsafe(
    `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref
     FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`
  );
  const clean = (s: string) => s.replace(/"/g, "");
  const edges = fkRes
    .map((r) => ({ tbl: clean(r.tbl), ref: clean(r.ref) }))
    .filter((e) => pgTables.has(e.tbl) && pgTables.has(e.ref) && e.tbl !== e.ref);

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const tableSet = new Set(sqliteTables);
  for (const t of sqliteTables) { indeg.set(t, 0); adj.set(t, []); }
  for (const e of edges) {
    if (!tableSet.has(e.ref) || !tableSet.has(e.tbl)) continue;
    adj.get(e.ref)!.push(e.tbl);
    indeg.set(e.tbl, (indeg.get(e.tbl) || 0) + 1);
  }
  const queue = sqliteTables.filter((t) => (indeg.get(t) || 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const t = queue.shift()!;
    order.push(t);
    for (const nxt of adj.get(t) || []) {
      const d = (indeg.get(nxt) || 0) - 1;
      indeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }
  for (const t of sqliteTables) if (!order.includes(t)) order.push(t); // كسر حلقات محتملة بالنهاية

  // 3) تفريغ الهدف (idempotent)
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${order.map(quote).join(", ")} RESTART IDENTITY CASCADE`
  );
  console.log(`✓ تم تفريغ ${order.length} جدولًا في Postgres`);

  // 4) الإدخال
  const report: { table: string; sqlite: number }[] = [];
  for (const table of order) {
    const cols = pgCols.get(table) || [];
    if (!cols.length) { console.warn(`⚠ لا أعمدة للجدول ${table} — تخطٍ`); continue; }
    const rows = sqlite.prepare<Record<string, unknown>, []>(`SELECT * FROM ${quote(table)}`).all();
    if (rows.length === 0) { report.push({ table, sqlite: 0 }); continue; }

    const colNames = cols.map((c) => c.name);
    const isBool = cols.map((c) => c.pgType === "boolean");
    const isTs = cols.map((c) => c.pgType.startsWith("timestamp"));
    // معاملات بأنواع صريحة: $n::<نوع العمود> — لأن Prisma يرسل المعاملات مطبوعة ولا يجري Postgres تحويلًا ضمنيًا
    const ph = (n: number) => `(${cols.map((_, j) => `$${n * cols.length + j + 1}::${cols[j].pgType}`).join(", ")})`;
    const baseInsert = `INSERT INTO ${quote(table)} (${colNames.map(quote).join(", ")}) VALUES `;

    // دفعات متعددة الصفوف (تقليل رحلات الشبكة إلى طوكيو) داخل معاملة لكل جدول بمهلة سخية
    const BATCH = 40;
    await prisma.$transaction(async (tx) => {
      for (let start = 0; start < rows.length; start += BATCH) {
        const chunk = rows.slice(start, start + BATCH);
        const sql = baseInsert + chunk.map((_, n) => ph(n)).join(", ");
        const params: unknown[] = [];
        for (const row of chunk) {
          for (let i = 0; i < colNames.length; i++) {
            let v = (row as Record<string, unknown>)[colNames[i]];
            if (v === undefined) v = null;
            else if (isBool[i] && (v === 0 || v === 1)) v = Boolean(v);
            else if (isTs[i] && typeof v === "number") v = epochToTsString(v); // epoch millis → 'YYYY-MM-DD HH:MM:SS.sss' UTC
            params.push(v);
          }
        }
        await tx.$executeRawUnsafe(sql, ...params);
      }
    }, { timeout: 180_000, maxWait: 30_000 });
    report.push({ table, sqlite: rows.length });
  }

  // 5) إعادة ضبط التسلسلات
  for (const table of order) {
    const hasId = (pgCols.get(table) || []).some((c) => c.name === "id");
    if (!hasId) continue;
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${quote(table)}), 0) + 1, false)`
    );
  }

  // 6) تحقق العدّادات الفعلي من Postgres
  console.log("\n===== تقرير الترحيل =====");
  let ok = true;
  for (const r of report) {
    const pgCountRes: { c: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS c FROM ${quote(r.table)}`
    );
    const pgCount = Number(pgCountRes[0]?.c ?? 0);
    const match = pgCount === r.sqlite;
    if (!match) ok = false;
    console.log(`${match ? "✓" : "✗"} ${r.table}: SQLite=${r.sqlite} → Postgres=${pgCount}`);
  }
  console.log(ok ? "\n✅ الترحيل مكتمل — كل العدادات مطابقة" : "\n⚠ فروقات في العدادات — راجع الأسطر أعلاه");
}

main()
  .catch((e) => { console.error("✗ فشل الترحيل:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); sqlite.close(); });
