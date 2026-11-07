/**
 * المسح الشامل للنظام — إعادة الضبط لكأنه أول تشغيل
 * يحفظ فقط: حساب المطور (developer) + خطط الاشتراك (plans) + أعلام الميزات (feature_flags)
 * كل ما عداه في public يُمسح: الشركات، المستخدمون، الاشتراكات، وكل البيانات التشغيلية.
 *
 * تشغيل: bun scripts/wipe/06-wipe.ts
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  // 1) التقاط الصفوف المحفوظة قبل المسح
  const devRows = await prisma.$queryRaw<any[]>`SELECT * FROM users WHERE role = 'developer'`;
  const planRows = await prisma.$queryRaw<any[]>`SELECT * FROM plans ORDER BY id`;
  const flagRows = await prisma.$queryRaw<any[]>`SELECT * FROM feature_flags ORDER BY key`;

  if (devRows.length !== 1) throw new Error(`متوقع مستخدم مطور واحد، وجدت ${devRows.length} — إيقاف احترازي`);
  if (planRows.length === 0) throw new Error("لا توجد خطط — إيقاف احترازي");

  console.log(`سيُحفظ: developer(id=${devRows[0].id}) + plans(${planRows.length}) + feature_flags(${flagRows.length})`);

  // 2) مسح كل جداول public (بما فيها users/plans/flags) مع إعادة عدّادات التسلسل
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`✓ TRUNCATE ${tables.length} جدولًا RESTART IDENTITY CASCADE`);

  // 3) إعادة إدراج حساب المطور كما هو (بنفس id وكلمة المرور)
  const d = devRows[0];
  await prisma.$executeRawUnsafe(
    `INSERT INTO users (id, username, password_hash, salt, role, full_name, job_title, active, "createdAt", company_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    d.id, d.username, d.password_hash, d.salt, d.role,
    d.full_name ?? "", d.job_title ?? "", d.active, d.createdAt, null
  );
  console.log(`✓ أُعيد إدراج المطور #${d.id} (${d.username}) بنفس بيانات الدخول`);

  // 4) إعادة إدراج الخطط
  for (const p of planRows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO plans (id, code, name, duration_days, max_users, max_divisions, price_monthly, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9)`,
      p.id, p.code, p.name, p.duration_days, p.max_users, p.max_divisions, String(p.price_monthly), p.is_active, p.sort_order
    );
  }
  console.log(`✓ أُعيد إدراج ${planRows.length} خطط`);

  // 5) إعادة إدراج الأعلام
  for (const f of flagRows) {
    await prisma.$executeRawUnsafe(`INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)`, f.key, f.enabled);
  }
  console.log(`✓ أُعيد إدراج ${flagRows.length} أعلام`);

  // 6) ضبط عدّادات التسلسل بعد الإدراج الصريح للأرقام
  for (const t of ["users", "plans"]) {
    const seq = await prisma.$queryRaw<{ seq: string | null }[]>`
      SELECT pg_get_serial_sequence(${t}, 'id') AS seq`;
    if (seq[0]?.seq) {
      await prisma.$executeRawUnsafe(
        `SELECT setval('${seq[0].seq}', GREATEST(COALESCE((SELECT MAX(id) FROM "${t}"), 1), 1))`
      );
    }
  }
  console.log("✓ ضُبطت عدّادات التسلسل");

  // 7) تحقق نهائي: أعداد دقيقة لكل الجداول
  const after = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  let nonEmpty = 0;
  const details: string[] = [];
  for (const { tablename } of after) {
    const r = await prisma.$queryRawUnsafe<{ n: number }>(`SELECT count(*)::int AS n FROM "${tablename}"`);
    if (r[0].n > 0) { nonEmpty++; details.push(`${tablename}=${r[0].n}`); }
  }
  console.log(`\n=== بعد المسح: جداول غير فارغة (${nonEmpty}) ===`);
  console.log(details.join(" | "));
  console.log(nonEmpty === 3 ? "\n✓✓ النظام نظيف — حالة أول تشغيل" : "\n⚠ تحقق يدوي: عدد الجداول غير الفارغة ليس 3");
} catch (e: any) {
  console.error("✗", e.message?.slice(0, 600));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
