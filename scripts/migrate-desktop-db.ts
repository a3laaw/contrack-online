/**
 * ترحيل قاعدة بيانات المكتبي (upload/database.sqlite) → Supabase Postgres
 * ========================================================================
 * المصدر: SQLite المكتبي الحقيقي (أعمدة snake_case + إضافات مكتبية)
 * الهدف: قاعدة الويب (مخطط Prisma الحالي على Supabase)
 *
 * الاستخدام (بروتوكول البيئة الالزماني — الصدفة تفرض DATABASE_URL=file:):
 *   تجربة جافة (معاملة واحدة ثم ROLLBACK — لا شيء يُخر):
 *     unset DATABASE_URL; set -a && . ./.env.local && set +a && bun scripts/migrate-desktop-db.ts --dry
 *   تنفيذ فعلي:
 *     unset DATABASE_URL; set -a && . ./.env.local && set +a && bun scripts/migrate-desktop-db.ts --run
 *
 * قواعد Task 60 الموثقة:
 * - محفوظة (ويب-فقط لا تُفرَّغ): feature_flags
 * - مُتخطاة (بلا مقابل بالويب أو مُعاد تصميمها): contract_components · contract_templates ·
 *   network_health_check · notifications · schema_flags · transaction_stage_log ·
 *   transaction_visibility · transaction_messages · sqlite_sequence · type_bundle_components
 * - الخرائط أدناه مبنية على diff عمودي-عمود (PRAGMA مقابل information_schema)
 * - تحويل الأنواع تلقائيًا حسب نوع عمود PG: boolean 0/1/""→false · timestamp ""→NULL ·
 *   عددية ""→NULL · أعمدة FK ذات القيمة 0→NULL (إن سمح العمود)
 * - number_sequences تُبنى من البيانات نفسها (أعلى لاحقة رقمية لكل عائلة عدّ)
 * - setval لكل تسلسلات serial بعد الإدخال (غير قابل للتراجع بالمعاملة — غير ضار بالتجربة الجافة)
 */
import { Database } from "bun:sqlite";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MODE = process.argv.includes("--run") ? "run" : process.argv.includes("--dry") ? "dry" : "";
if (!MODE) {
  console.error("الاستخدام: bun scripts/migrate-desktop-db.ts --dry | --run");
  process.exit(1);
}
const SQLITE_PATH = process.env.SQLITE_PATH || resolve(import.meta.dir, "..", "upload", "database.sqlite");
if (!existsSync(SQLITE_PATH)) {
  console.error(`✗ ملف SQLite غير موجود: ${SQLITE_PATH}`);
  process.exit(1);
}
const sqlite = new Database(SQLITE_PATH, { readonly: true });
// الجلسة 5432 أثبت للمعاملة الطويلة من Transaction pooler 6543
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "" } },
});

type ColInfo = { name: string; type: string };
type Plan = { sq: string | null; pg: string; type: string; constVal?: any };

/** جداول SQLite تُتخطى كليًا (بلا مقابل بالويب أو مُعاد تصميمها — موثقة) */
const SKIP_SQLITE = new Set([
  "contract_components",
  "contract_templates",
  "network_health_check",
  "notifications",
  "schema_flags",
  "transaction_stage_log",
  "transaction_visibility",
  "transaction_messages",
  "sqlite_sequence",
  "type_bundle_components", // مُعاد تصميمها بالويب كليًا (parent_type_id/component_type_id/qty) — 5 صفوف موثقة
  "quotations", // مُعاد تصميمها بالويب (§49) بلا أي صف بالمصدر
  "quotation_items", // مُعاد تصميمها بالويب (§50) بلا أي صف بالمصدر
]);

/** جداول PG تُترك (ويب-فقط): لا تفريغ ولا لمس */
const PRESERVE_PG = new Set(["feature_flags"]);

/** [عمود SQLite → عمود PG] للأسماء المختلفة. "@lookup:COL" = ربط بالاسم عبر جدول contract_types */
const RENAMES: Record<string, Record<string, string>> = {
  customers: { address_governorate: "governorate", address_area: "area", address_block: "block", address_plot: "plot", created_at: "createdAt" },
  contracts: { created_at: "createdAt", updated_at: "updatedAt" },
  users: { created_at: "createdAt" },
  payment_plan: { created_at: "createdAt" },
  vouchers: { created_at: "createdAt" },
  sub_contracts: { created_at: "createdAt" },
  subcontractors: { created_at: "createdAt" },
  claims: { created_at: "createdAt" },
  customer_comments: { created_at: "createdAt" },
  journal_entries: { created_at: "createdAt" },
  tasks: { created_at: "createdAt" },
  contract_groups: { created_at: "createdAt" },
  invoices: { created_at: "createdAt" },
  visits: { created_at: "createdAt" },
  stage_notes: { transaction_type: "txType", transaction_id: "txId", created_at: "createdAt" },
  form_templates: { created_at: "createdAt" },
  form_documents: { created_at: "createdAt" },
  gateway_ops: { created_at: "createdAt" },
  bank_lines: { created_at: "createdAt" },
  match_aliases: { created_at: "createdAt" },
  other_company_opening: { updated_at: "updatedAt" },
  other_company_transfers: { created_at: "createdAt" },
  voucher_payment_links: { created_at: "createdAt" },
  audit_log: { timestamp: "ts" },
  addendum_items: { created_item: "created_item_id" },
  type_payment_tpl: { contract_type: "@lookup:contract_type_id" },
};

/** أعمدة SQLite تُهجر (بلا مقابل بالويب — موثقة) */
const DROPS: Record<string, string[]> = {
  customers: ["folder_seen", "created_by", "updated_by", "updated_at"],
  contracts: ["project_id", "created_by", "updated_by"],
  settings: [
    "logo_path", "invoice_primary", "invoice_accent", "auto_backup_folder", "last_backup_at",
    "task_wa_customer", "task_wa_manager", "wa_appt", "wa_reminder", "wa_payment",
    "manager_phone", "app_name", "max_users", "full_backup_enabled", "full_backup_interval_days",
    "full_backup_weekday", "visits_start_hour", "stages_seeded", "visits_end_hour", "visits_slot_minutes",
    "full_backup_keep_weekly", "full_backup_keep_monthly", "full_backup_folder", "last_full_backup_at",
    "opening_balance", "header_image", "footer_image", "print_economy", "stamp_image",
    "stamp_x_mm", "stamp_y_mm", "stamp_size_mm", "signature_image", "license_key", "forms_hide_footer",
  ],
  projects: ["project_code"],
  boq_items: ["deleted_at"],
  type_payment_tpl: ["stage_id"], // أعيد تصميمه: العلاقة تعيش في type_payment_stages
  contract_types: ["created_at"],
  addendums: ["notes", "created_at"],
  sub_payment_sources: ["created_at"],
  addendum_items: ["created_at", "subcontractor_id"],
  sub_payment_plan: ["created_at"], // بلا مقابل بPG
  claims: ["created_by", "updated_at"],
  expense_accounts: ["created_at", "updated_at"],
  contract_group_items: ["added_at"],
  stage_notes: ["customer_id", "created_by"],
  audit_log: ["ip_address"],
  sub_contracts: ["project_id"],
};

/** أعمدة PG بلا مصدر SQLite — قيمة ثابتة أو دالة من الصف الأصلي */
const ADDS: Record<string, Record<string, any>> = {
  users: { active: true },
  projects: { location: "", start_date: "", end_date: "", updated_at: (r: any) => r.created_at ?? null },
  boq_items: { amount: (r: any) => Number(r.qty ?? 0) * Number(r.unit_price ?? 0), deleted: (r: any) => Boolean(r.deleted_at), sort_order: 0 },
  settings: { updatedAt: () => new Date() }, // PG @updatedAt NOT NULL — المكتبي بلا مقابل
};

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const cleanReg = (s: string) => s.replace(/"/g, "");
/** cast صريح لكل معامل — Prisma يرسل النصوص بtype=text وPG يرفض التحويل الضمني إلى timestamp/numeric */
function castFor(type: string): string {
  if (type === "timestamp without time zone") return "::timestamp";
  if (type === "timestamp with time zone") return "::timestamptz";
  if (type.startsWith("numeric")) return "::numeric";
  if (type === "boolean") return "::boolean";
  if (type === "integer") return "::integer";
  if (type === "bigint") return "::bigint";
  if (type === "double precision") return "::double precision";
  if (type === "real") return "::real";
  return "";
}

async function main() {
  // ===== 1) كتالوج PG =====
  const pgTables = (
    await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
    )
  ).map((r) => r.table_name);
  const pgCols = new Map<string, ColInfo[]>();
  for (const c of await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string }[]>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`
  )) {
    if (!pgCols.has(c.table_name)) pgCols.set(c.table_name, []);
    pgCols.get(c.table_name)!.push({ name: c.column_name, type: c.data_type });
  }
  const fkRes = await prisma.$queryRawUnsafe<{ tbl: string; ref: string; cols: string }[]>(
    `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref,
            (SELECT string_agg(attname, ',' ORDER BY attnum) FROM unnest(conkey) a JOIN pg_attribute att ON att.attrelid=conrelid AND att.attnum=a) AS cols
     FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`
  );
  const fkCols = new Map<string, Set<string>>();
  for (const r of fkRes) {
    const t = cleanReg(r.tbl);
    if (!fkCols.has(t)) fkCols.set(t, new Set());
    for (const c of (r.cols || "").split(",")) if (c) fkCols.get(t)!.add(c);
  }
  const nullableCols = new Set<string>();
  for (const r of await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND is_nullable='YES'`
  )) nullableCols.add(`${r.table_name}.${r.column_name}`);

  // ===== 2) جداول المصدر + الترتيب الطوبولوجي حسب FK =====
  const sqliteTables = sqlite
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name)
    .filter((t) => !SKIP_SQLITE.has(t))
    .filter((t) => pgCols.has(t));
  const tableSet = new Set(sqliteTables);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of sqliteTables) { indeg.set(t, 0); adj.set(t, []); }
  for (const e of fkRes) {
    const tbl = cleanReg(e.tbl), ref = cleanReg(e.ref);
    if (!tableSet.has(tbl) || !tableSet.has(ref) || tbl === ref) continue;
    adj.get(ref)!.push(tbl);
    indeg.set(tbl, (indeg.get(tbl) || 0) + 1);
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
  if (order.length !== sqliteTables.length) {
    console.error("✗ دورة FK في الترتيب التوبولوجي:", sqliteTables.filter((t) => !order.includes(t)).join(","));
    process.exit(1);
  }

  // فحص مسبق: صفوف بمراجع معلقة (SQLite لا يفرض FK — وُجدت 3 في contract_scope) — تُستبعد وتُوثق
  const excludedRowids = new Map<string, number[]>();
  for (const e of fkRes) {
    const tbl = cleanReg(e.tbl), ref = cleanReg(e.ref);
    if (!tableSet.has(tbl) || !tableSet.has(ref)) continue;
    const cols = (e.cols || "").split(",").filter(Boolean);
    if (cols.length !== 1) continue;
    const col = cols[0];
    const hasC = (sqlite.query(`PRAGMA table_info(${q(tbl)})`).all() as any[]).some((x: any) => x.name === col);
    if (!hasC) continue;
    let rows: any[] = [];
    try {
      rows = sqlite
        .query(`SELECT rowid AS rid FROM ${q(tbl)} WHERE ${q(col)} IS NOT NULL AND ${q(col)} != 0 AND ${q(col)} NOT IN (SELECT id FROM ${q(ref)})`)
        .all() as any[];
    } catch { continue; }
    if (rows.length) {
      excludedRowids.set(tbl, rows.map((r) => Number(r.rid)));
      console.log(`  ⚠ ${tbl}.${col} → ${ref}: ${rows.length} صفًا بمرجع معلق (غير موجود بالمصدر) — ستُستبعد وتُوثق`);
    }
  }

  console.log(`الوضع: ${MODE === "dry" ? "تجربة جافة (ROLLBACK في النهاية)" : "تنفيذ فعلي"}`);
  console.log(`جداول المنقولة: ${sqliteTables.length} · المُتخطاة: ${SKIP_SQLITE.size} · المحفوظة: ${[...PRESERVE_PG].join(",")}`);

  let rollbackDone = false;
  try {
    await prisma.$transaction(
      async (tx) => {
        // ===== 3) تفريغ كل جداول PG عدا المحفوظة =====
        const toTruncate = pgTables.filter((t) => !PRESERVE_PG.has(t));
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${toTruncate.map(q).join(",")} RESTART IDENTITY CASCADE`);

        // ===== 4) الإدخال بترتيب توبولوجي =====
        const report: { table: string; src: number; dst: number }[] = [];
        for (const table of order) {
          if (PRESERVE_PG.has(table)) continue; // ويب-فقط — لا تفريغ ولا إدخال
          console.log(`  ↪ ${table}…`);
          const renames = RENAMES[table] || {};
          const drops = new Set(DROPS[table] || []);
          const adds = ADDS[table] || {};
          const sqCols = (sqlite.query(`PRAGMA table_info(${q(table)})`).all() as any[]).map((c) => c.name as string);
          const pgList = pgCols.get(table)!;
          const pgByName = new Map(pgList.map((c) => [c.name, c]));

          const plan: Plan[] = [];
          for (const [sqc, target] of Object.entries(renames)) {
            if (target.startsWith("@lookup:")) {
              const pgc = target.slice("@lookup:".length);
              const info = pgByName.get(pgc);
              if (!info) throw new Error(`خريطة ${table}.${sqc}: الهدف ${pgc} غير موجود بPG`);
              plan.push({ sq: sqc, pg: pgc, type: info.type });
              continue;
            }
            const info = pgByName.get(target);
            if (!info) throw new Error(`خريطة ${table}.${sqc}→${target}: غير موجود بPG`);
            plan.push({ sq: sqc, pg: target, type: info.type });
          }
          for (const sqc of sqCols) {
            if (drops.has(sqc)) continue;
            if (Object.keys(renames).includes(sqc)) continue;
            const info = pgByName.get(sqc);
            if (!info) { console.log(`  ⚠ ${table}.${sqc}: بلا مقابل بPG — أُهجر`); continue; }
            plan.push({ sq: sqc, pg: sqc, type: info.type });
          }
          for (const [pgc, val] of Object.entries(adds)) {
            const info = pgByName.get(pgc);
            if (!info) throw new Error(`إضافة ${table}.${pgc}: غير موجودة بPG`);
            plan.push({ sq: null, pg: pgc, type: info.type, constVal: val });
          }
          plan.sort((a, b) => (a.pg === "id" ? 0 : 1) - (b.pg === "id" ? 0 : 1));

          const excl = excludedRowids.get(table);
          const rows = sqlite
            .query(`SELECT * FROM ${q(table)}${excl?.length ? ` WHERE rowid NOT IN (${excl.join(",")})` : ""}`)
            .all() as any[];
          const CHUNK = 200;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const values: any[] = [];
            const tuples: string[] = [];
            for (const r of chunk) {
              const ph: string[] = [];
              for (const p of plan) {
                let v: any;
                if (p.sq === null) v = typeof p.constVal === "function" ? p.constVal(r) : p.constVal;
                else if (table === "type_payment_tpl" && p.pg === "contract_type_id") {
                  if (r.contract_type == null || r.contract_type === "") v = null;
                  else {
                    const trow = await tx.$queryRawUnsafe<{ id: number }[]>(
                      `SELECT id FROM contract_types WHERE name = $1 LIMIT 1`, r.contract_type
                    );
                    if (!trow.length) throw new Error(`type_payment_tpl: نوع غير معروف «${r.contract_type}»`);
                    v = trow[0].id;
                  }
                } else v = r[p.sq!];
                if (v === undefined) v = null;
                if (p.type === "boolean") {
                  v = v == null ? null : v === 0 || v === "" || v === "0" || v === false ? false : true;
                } else if (p.type.includes("timestamp") && v === "") v = null;
                else if ((p.type === "integer" || p.type === "bigint" || p.type.startsWith("numeric") || p.type === "double precision" || p.type === "real") && v === "") v = null;
                // @updatedAt/@createdAt NOT NULL بالويب — سقطات آمنة: updated_at→created_at→الآن
                if (v == null && p.type.includes("timestamp") && (p.pg === "createdAt" || p.pg === "updatedAt")) {
                  const srcCreated = r.created_at ?? r.createdAt ?? null;
                  v = p.pg === "createdAt" ? srcCreated || new Date() : r.updated_at || r.updatedAt || srcCreated || new Date();
                }
                if (v === 0 && p.type === "integer" && fkCols.get(table)?.has(p.pg) && nullableCols.has(`${table}.${p.pg}`)) v = null;
                // عمود NOT NULL بلا افتراض تلقى null — عرف الويب/المكتبي 0 يعني «لا شيء» (موثق)
                if (v == null && (p.type === "integer" || p.type === "bigint") && !nullableCols.has(`${table}.${p.pg}`)) {
                  v = 0;
                  console.log(`    · ${table}.${p.pg}: null → 0 (NOT NULL)`);
                }
                // نص NOT NULL تلقى null → نص فارغ · عددية NOT NULL → صفر (بأسلوب الواجهة)
                if (v == null && p.type === "text" && !nullableCols.has(`${table}.${p.pg}`)) {
                  v = "";
                  console.log(`    · ${table}.${p.pg}: null → "" (NOT NULL text)`);
                }
                if (v == null && (p.type.startsWith("numeric") || p.type === "double precision" || p.type === "real") && !nullableCols.has(`${table}.${p.pg}`)) {
                  v = 0;
                  console.log(`    · ${table}.${p.pg}: null → 0 (NOT NULL numeric)`);
                }
                // NaN/Infinity لا يمكن تمريرها معاملًا — تُطيَّب مع توثيق
                if (typeof v === "number" && !Number.isFinite(v)) {
                  console.log(`    · ${table}.${p.pg}: ${v} → null (قيمة غير منتهية بالصف id=${r.id ?? "?"})`);
                  v = null;
                }
                values.push(v);
                ph.push(`$${values.length}${castFor(p.type)}`);
              }
              tuples.push(`(${ph.join(",")})`);
            }
            if (tuples.length) {
              await tx.$executeRawUnsafe(
                `INSERT INTO ${q(table)} (${plan.map((p) => q(p.pg)).join(",")}) VALUES ${tuples.join(",")}`,
                ...values
              );
            }
          }
          report.push({ table, src: rows.length, dst: rows.length });
          if (excl?.length) console.log(`    · أُستبعد ${excl.length} صفًا معلقًا من ${table}`);
        }

        // form_documents.doc_number = FD-%04d بترتيب id (المصدر بلا ترقيم)
        console.log("  ⚙ مرحلة doc_number…");
        const docs = await tx.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM form_documents ORDER BY id`);
        for (let i = 0; i < docs.length; i++) {
          await tx.$executeRawUnsafe(`UPDATE form_documents SET doc_number = $1 WHERE id = $2`, `FD-${String(i + 1).padStart(4, "0")}`, docs[i].id);
        }

        // ===== 5) إعادة بناء number_sequences من البيانات نفسها =====
        console.log("  ⚙ مرحلة number_sequences…");
        await tx.$executeRawUnsafe(`TRUNCATE TABLE number_sequences RESTART IDENTITY CASCADE`);
        const seqRows: { name: string; lastNo: number }[] = [];
        const vpfx = await tx.$queryRawUnsafe<{ p: string; mx: number | null }[]>(
          `SELECT substring(voucher_number from '^([A-Z]+)-') AS p,
                  MAX(NULLIF(substring(voucher_number from '^[A-Z]+-(\\d+)$'), '')::bigint) AS mx
           FROM vouchers WHERE voucher_number ~ '^[A-Z]+-\\d+$' GROUP BY 1`
        );
        for (const { p, mx } of vpfx)
          seqRows.push({ name: `voucher:${p}`, lastNo: Math.max(Number(mx || 0), p === "PV" ? 47 : p === "RV" ? 34 : 0) });
        const maxSuffix = async (table: string, col: string, prefix: string) => {
          const r = await tx.$queryRawUnsafe<{ mx: number | null }[]>(
            `SELECT MAX(NULLIF(substring(${q(col)} from '^${prefix}-(\\d+)$'), '')::bigint) AS mx FROM ${q(table)} WHERE ${q(col)} ~ '^${prefix}-\\d+$'`
          );
          return Number(r[0]?.mx ?? 0);
        };
        seqRows.push({ name: "voucher:CLM", lastNo: await maxSuffix("claims", "claim_number", "CLM") });
        seqRows.push({
          name: "customer:code",
          lastNo: Math.max(await maxSuffix("customers", "customer_code", "C"), await maxSuffix("customers", "customer_code", "CUS")),
        });
        seqRows.push({ name: "contract:number", lastNo: await maxSuffix("contracts", "contract_number", "CON") });
        seqRows.push({ name: "subcontractor:code", lastNo: await maxSuffix("subcontractors", "sub_code", "SUB") });
        const addPfx = await tx.$queryRawUnsafe<{ cid: number; mx: number | null }[]>(
          `SELECT contract_id AS cid, MAX(NULLIF(substring(addendum_number from '^ADD-(\\d+)$'), '')::bigint) AS mx
           FROM addendums WHERE addendum_number ~ '^ADD-\\d+$' GROUP BY contract_id`
        );
        for (const { cid, mx } of addPfx) seqRows.push({ name: `addendum:contract:${cid}`, lastNo: Number(mx || 0) });
        for (const s of seqRows)
          await tx.$executeRawUnsafe(`INSERT INTO number_sequences (name, last_no) VALUES ($1, $2)`, s.name, s.lastNo);

        // ===== 6) setval لكل تسلسلات serial (غير قابل للتراجع — غير ضار) =====
        console.log("  ⚙ مرحلة setval…");
        const pks = await tx.$queryRawUnsafe<{ t: string; c: string }[]>(
          `SELECT conrelid::regclass::text AS t,
                  (SELECT attname FROM pg_attribute WHERE attrelid=conrelid AND attnum=conkey[1]) AS c
           FROM pg_constraint WHERE contype='p' AND connamespace='public'::regnamespace`
        );
        for (const s of pks) {
          const t = cleanReg(s.t);
          if (!s.c) continue;
          const mx = await tx.$queryRawUnsafe<{ m: number | null }[]>(`SELECT MAX(${q(s.c)}) AS m FROM ${q(t)}`);
          const m = Number(mx[0]?.m ?? 0);
          if (!Number.isFinite(m)) { console.log(`    · setval ${t}.${s.c}: MAX غير رقمي (${mx[0]?.m}) — يُتجاهل`); continue; }
          await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${t}', '${s.c}'), ${Math.max(m, 1)}, ${m > 0})`);
        }

        // ===== 7) تقرير المقارنة =====
        console.log("\n=== عدّ المدرج (SQLite → PG) ===");
        let mismatch = 0;
        for (const table of order) {
          if (PRESERVE_PG.has(table)) continue;
          const srcRaw = Number(sqlite.query(`SELECT COUNT(*) n FROM ${q(table)}`).get()!.n);
          const excluded = excludedRowids.get(table)?.length || 0;
          const expected = table === "number_sequences" ? seqRows.length : srcRaw - excluded;
          const dstRow = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM ${q(table)}`);
          const dst = Number(dstRow[0].n);
          const ok = expected === dst;
          if (!ok) mismatch++;
          console.log(`${ok ? "✓" : "✗"} ${table}: ${srcRaw}${excluded ? `-${excluded}معلق` : ""} → ${dst}${table === "number_sequences" ? " (مُعاد بناؤه من البيانات)" : ""}`);
        }
        const ffN2 = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM feature_flags`);
        console.log(`- feature_flags: محفوظة كما هي = ${ffN2[0].n} (ويب-فقط)`);
        const seqN = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM number_sequences`);
        const ffN = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM feature_flags`);
        const users = await tx.$queryRawUnsafe<{ username: string; role: string }[]>(`SELECT username, role FROM users ORDER BY id`);
        console.log(`\nnumber_sequences: ${seqN[0].n} عدّادًا · feature_flags محفوظة: ${ffN[0].n} · المستخدمون: ${users.map((u) => `${u.username}(${u.role})`).join(", ")}`);
        if (mismatch) throw new Error(`${mismatch} جدولًا بعدم تطابق العدّ`);
        console.log(MODE === "dry" ? "\n[DRY] نجحت التجربة — ROLLBACK الآن (لن يُخرَّج شيء)" : "\n[RUN] اكتمل الإدخال الفعلي");
        if (MODE === "dry") throw { __dryRollback: true };
      },
      { timeout: 300000 }
    );
    console.log("✅ الترحيل دُخر بمعاملة مكتملة.");
  } catch (e: any) {
    if (e && e.__dryRollback) {
      rollbackDone = true;
      console.log("↩ ROLLBACK تم — القاعدة عادت كما كانت قبل التجربة الجافة.");
    } else {
      console.error("✗ فشل الترحيل (ROLLBACK تلقائي):", e?.message || e);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    sqlite.close();
  }
  if (MODE === "dry" && !rollbackDone) console.error("⚠ تحذير: التجربة الجافة لم تمر بمسار ROLLBACK المتوقع");
}

main();
