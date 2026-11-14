/**
 * dev-postgres.ts — تشغيل Postgres المحلي المضمّن (بلا root) — بيئة التطوير المطابقة لفيرسال.
 *   bun run db:up
 *  • initdb مرة واحدة (db/pgdata) ثم pg_ctl start على المنفذ 5433
 *  • إنشاء قاعدة contrack عند أول تشغيل
 *  • idempotent: يتحقق من المنفذ قبل أي عملية فلا فشل عند التكرار
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const PG = path.join(ROOT, "node_modules", "@embedded-postgres", "linux-x64", "native");
const BIN = path.join(PG, "bin");
const LIB = path.join(PG, "lib");
const DATA = path.join(ROOT, "db", "pgdata");
const LOG = path.join(ROOT, "db", "pg.log");
const PORT = 5433;
const URL = `postgres://contrack@localhost:${PORT}/postgres`;

async function portOpen(port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    conn.end();
    return true;
  } catch {
    return false;
  }
}

// روابط ICU المطلوبة للحمّالة الديناميكية (الحزمة تجلب .60.2 والثنائيات تطلب .60)
function ensureIcuSymlinks() {
  for (const n of ["libicuuc", "libicui18n", "libicudata"]) {
    const real = path.join(LIB, `${n}.so.60.2`);
    const link = path.join(LIB, `${n}.so.60`);
    if (fs.existsSync(real) && !fs.existsSync(link)) fs.symlinkSync(real, link);
  }
}

ensureIcuSymlinks();
if (await portOpen(PORT)) {
  console.log(`Postgres يعمل أصلًا على ${PORT} — لا شيء يُفعل`);
  process.exit(0);
}

const env = { ...process.env, LD_LIBRARY_PATH: LIB };

if (!fs.existsSync(path.join(DATA, "PG_VERSION"))) {
  const init = Bun.spawnSync([path.join(BIN, "initdb"), "-D", DATA, "-U", "contrack", "-A", "trust", "-E", "UTF8"], { env, stdout: "pipe", stderr: "pipe" });
  if (!init.success) {
    console.error(new TextDecoder().decode(init.stderr));
    process.exit(1);
  }
  console.log("تم تهيئة db/pgdata (مرة واحدة)");
}

const ctl = (args: string[]) =>
  Bun.spawnSync([path.join(BIN, "pg_ctl"), "-D", DATA, "-l", LOG, "-o", `-p ${PORT} -k /tmp`, ...args], { env, stdout: "pipe", stderr: "pipe" });

const start = ctl(["start"]);
if (!start.success) {
  console.error(new TextDecoder().decode(start.stderr) || new TextDecoder().decode(start.stdout));
  process.exit(1);
}
console.log(`Postgres بدأ على المنفذ ${PORT} — السجل: db/pg.log`);

for (let i = 0; i < 20; i++) {
  if (await portOpen(PORT)) break;
  await Bun.sleep(250);
}

const q = new SQL(URL);
try {
  await q.unsafe("CREATE DATABASE contrack");
  console.log("أنشئت قاعدة contrack (مرة واحدة)");
} catch (e) {
  if (!String(e).includes("already exists")) throw e;
}
await q.end();
console.log(`جاهز: DATABASE_URL=postgresql://contrack@localhost:${PORT}/contrack`);
